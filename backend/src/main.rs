use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::{env, fmt};

extern crate serde;
use rand::prelude::{thread_rng, Rng};
use warp::{http, Filter};

/// Helper for hex-representing u8 slices
struct HexSlice<'a>(&'a [u8]);

impl<'a> HexSlice<'a> {
    fn new<T>(data: &'a T) -> HexSlice<'a>
    where
        T: ?Sized + AsRef<[u8]> + 'a,
    {
        HexSlice(data.as_ref())
    }
}

impl fmt::Display for HexSlice<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for byte in self.0 {
            write!(f, "{:x}", byte)?;
        }
        Ok(())
    }
}

mod models {
    use super::*;


    #[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
    pub struct SafeRepresentation {
        #[serde(skip_serializing)]
        pub open_duration: u64,

        #[serde(skip_serializing)]
        pub unlocks_left: Option<u32>,

        pub nonce: String,
        pub secrets: String,
    }

    #[derive(Debug, Clone)]
    pub struct Safe {
        pub created_at: std::time::Instant,
        pub open_duration: std::time::Duration,
        pub unlocks_left: u32,
        pub nonce: String,
        pub secrets: String,
    }

    impl Safe {
        pub fn from_representation(repr: &SafeRepresentation) -> Self {
            Safe {
                created_at: std::time::Instant::now(),
                open_duration: std::time::Duration::new(repr.open_duration, 0),
                unlocks_left: repr.unlocks_left.unwrap_or(1),
                nonce: repr.nonce.clone(),
                secrets: repr.secrets.clone(),
            }
        }

        pub fn to_representation(self: &Self) -> SafeRepresentation {
            SafeRepresentation {
                open_duration: self.open_duration.as_secs(),
                unlocks_left: None,
                nonce: self.nonce.clone(),
                secrets: self.secrets.clone(),
            }
        }
    }
}

#[derive(Clone)]
pub struct Vault {
    safes: Arc<RwLock<HashMap<String, models::Safe>>>,
}

impl Vault {
    fn new() -> Self {
        Vault {
            safes: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    fn safe_exists(self: &Self, id: &str) -> bool {
        let readable_safes = self.safes.read().unwrap();
        return readable_safes.contains_key(id);
    }

    fn lock_safe(self: &Self, id: String, safe: models::Safe) {
        let mut writable_safes = self.safes.write().unwrap();
        writable_safes.insert(id, safe);
    }

    fn unlock_safe(self: &Self, id: &str) -> Option<models::Safe> {
        let mut writable_safes = self.safes.write().unwrap();
        let mut remove = false;
        let result = match writable_safes.get_mut(id) {
            Some(safe) if std::time::Instant::now() - safe.open_duration < safe.created_at => {
                safe.unlocks_left -= 1;
                remove = safe.unlocks_left == 0;
                Some(safe.clone())
            }
            Some(_) => {
                remove = true;
                None
            }
            None => None,
        };
        if remove {
            writable_safes.remove(id);
        }
        result
    }
}

// --- Warp helpers ---

fn json_ok<T: serde::ser::Serialize>(value: &T) -> warp::reply::WithStatus<warp::reply::Json> {
    warp::reply::with_status(warp::reply::json(value), http::StatusCode::OK)
}

fn json_not_found<T: serde::ser::Serialize>(
    value: &T,
) -> warp::reply::WithStatus<warp::reply::Json> {
    warp::reply::with_status(warp::reply::json(value), http::StatusCode::NOT_FOUND)
}

fn json_body<T: serde::de::DeserializeOwned + Send>(
    size_limit: u64,
) -> impl Filter<Extract = (T,), Error = warp::Rejection> + Clone {
    warp::body::content_length_limit(size_limit).and(warp::body::json())
}

/// Handlers for the public API
mod handlers {
    use super::*;
    use models::{Safe, SafeRepresentation};

    pub async fn unlock_safe(
        id: String,
        vault: Vault,
    ) -> Result<impl warp::Reply, warp::Rejection> {
        match vault.unlock_safe(&id) {
            Some(safe) => Ok(json_ok(&safe.to_representation())),
            None => {
                let mut error = HashMap::new();
                error.insert("message", format!("Safe '{}' not found", id));
                Ok(json_not_found(&error))
            }
        }
    }

    pub async fn lock_safe(
        safe_repr: SafeRepresentation,
        vault: Vault,
    ) -> Result<impl warp::Reply, warp::Rejection> {
        let mut id_bytes = [0u8; 16];
        thread_rng().fill(&mut id_bytes[..]);
        let id = format!("{}", HexSlice::new(&id_bytes));

        let safe = Safe::from_representation(&safe_repr);
        vault.lock_safe(id.clone(), safe);

        let mut response_body = HashMap::new();
        response_body.insert("href", format!("/safes/{}", id));
        Ok(json_ok(&response_body))
    }
}

fn with_vault(
    vault: Vault,
) -> impl Filter<Extract = (Vault,), Error = std::convert::Infallible> + Clone {
    warp::any().map(move || vault.clone())
}

#[tokio::main]
async fn main() {
    let port = env::var("PORT")
        .ok()
        .map(|x| x.parse::<u16>())
        .unwrap_or(Ok(8080));
    if port.is_err() {
        println!("[ERROR] Invalid port: {}", port.unwrap_err());
        return;
    }

    let vault = Vault::new();

    let store_secret = warp::path!("safes")
        .and(warp::post())
        .and(json_body(32 * 1024))
        .and(with_vault(vault.clone()))
        .and_then(handlers::lock_safe);

    let get_safe = warp::path("safes")
        .and(warp::path::param::<String>())
        .and(warp::path::end())
        .and(warp::get())
        .map(|_| ())
        .untuple_one()
        .and(warp::fs::file("./index.html"));

    let unlock_safe = warp::path!("safes" / String)
        .and(warp::post())
        .and(with_vault(vault))
        .and_then(handlers::unlock_safe);

    let statics = warp::path("static")
        .and(warp::fs::dir("./static/"));

    let index = warp::path::end().and(warp::fs::file("./index.html"));

    warp::serve(get_safe.or(unlock_safe).or(store_secret).or(statics).or(index))
        .run(([0, 0, 0, 0], port.unwrap()))
        .await;
}
