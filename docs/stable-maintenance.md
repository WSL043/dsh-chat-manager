# Stable compatibility maintenance

The default branch may contain an unpublished next candidate. Scheduled compatibility checks on main then validate and dispatch the stable branch instead of publishing development source or silently holding stable users.

Bootstrap stable from the published tag matching the package registry's latest stable version, and apply only the maintenance workflow, validator, tests and this guide. Keep runtime source at that published baseline. The scheduler verifies the npm archive against its SHA-512 integrity, checks the fixed bootstrap source commit and npm integrity in .github/stable-maintenance.json, and checks tag ancestry, source and runtime manifest fields before dispatch. Legacy plugin GitHub releases may have immutable=false; the official DSH target release gate remains immutable=true. A prepared patch version may remain on stable for publication recovery.

The stable run generates exact installation peers from official releases, builds one candidate archive, and runs the existing full official-page matrix. Only a successful matrix may commit compatibility metadata to stable and invoke that branch's release workflow. Release repeats its existing acceptance gates. No peer admission is itself a claim of behavioral compatibility.

Publish workflows accept only main or stable; stable requires a final patch version and uses the latest npm channel. Development next versions remain on main. The stable branch must be pushed alongside the routing change before scheduled forwarding can succeed; a missing or divergent branch fails visibly.

When a new stable feature line replaces npm latest, refresh the bootstrap source commit and npm integrity as part of that feature release. Core-only compatibility updates never change these anchors.
