# Security

Report security issues privately through the repository security advisory form.

The restore endpoint accepts only same-origin JSON `POST` requests carrying the explicit recovery action header. It changes only the official archived-session ID set and does not read, search, return, or delete session content.
