# V2 compatibility and release maintenance

The package declares exact qualified peers in package.json and records each official core's immutable GitHub tag, source commit and npm SHA-512 in compatibility.json. The official Windows browser job installs the same plugin archive that the release job receives. It independently stages the declared DSH version and checks the installed lock against the recorded npm integrity.

The hourly workflow considers official final and RC versions on npm's latest and next channels. It waits for the immutable GitHub release, verifies the exact npm archive, and prepares one patch against the new core and the preceding supported core. Both must pass the existing archive, deletion and plugin lifecycle acceptance. Alpha builds can be explored separately.

A manual run of the compatibility workflow qualifies the candidate without promotion. Scheduled promotion activates once a v2 package is published to npm latest and has a matching immutable GitHub release. After acceptance it commits only package.json and compatibility.json, checks the main revision, and invokes the trusted release workflow with that commit and package digest. An incomplete compatibility publication can retry from the prepared metadata and the previous immutable release. A changed client, unsupported API, or failed acceptance stops promotion.

Publish the first v2 version from main using the Release workflow and bilingual user-facing notes. Verify the npm version, its dist-tag, and the immutable GitHub package after publication. The historical stable branch retains the v1 workflow and documentation. This branch schedules v2 only.
