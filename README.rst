===========
Kuchenblech
===========

A secret sharing service that requires minimal trust.


How does it work?
=================

Kuchenblech creates an unique key for each sharing of secrets and encrypts the
secrets directly in the browser before they are sent to the server. The key is
then added to the share link as fragment, hence theoretically, the browser
should never send the key to the server and therefor the server never knows the
secrets.

The encryption is done with ChaCha20, Poly1305 is used as message authentication
code (see `RFC-7539 <https://tools.ietf.org/html/rfc7539>`_). `libsodium.js
<https://github.com/jedisct1/libsodium.js/>`_, a JavaScript port of `libsodium
<https://doc.libsodium.org/>`_, is used for the implementation.


Contributors
============

The following people (listed in alphabetical order) have provided substantial
code or other contributions to Kuchenblech. If your name is missing, please let
me know.

* `Andreas Stührk <https://github.com/Trundle/>`_
* `Lukas Stührk <https://github.com/Lukas-Stuehrk/>`_


License
=======

Kuchenblech is released under the Apache License, Version 2.0. See ``LICENSE``
or http://www.apache.org/licenses/LICENSE-2.0.html for details.

