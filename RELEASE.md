To test a release one can create a prerelease and it will run npm publish with the --dry-run argument.

This was implemented with prereleases since github does currently not support workflow triggers for draft releases. ([Github discussion](https://github.com/orgs/community/discussions/7118))

Published normal releases automatically update the npm package.
