# NPM Publish

The npm packages are wrappers around the Python controller and agent packages:

- `@sunjiehao/vpsmonitor-main`
- `@sunjiehao/vpsmonitor-sub`

They include the required Python source in the npm tarball at publish time, so users do not need to know a GitHub username or repository URL to install.

## Account Requirement

Publishing to npm requires an npm account that can publish under the `@sunjiehao` scope.

Check the current account:

```bash
npm whoami
```

Login if needed:

```bash
npm login
```

If `@sunjiehao` is not your npm user or organization scope, either create that scope on npm or rename the package scope in:

- `npm/vpsmonitor-main/package.json`
- `npm/vpsmonitor-sub/package.json`
- the npm command strings in `npm/vpsmonitor-main/bin/vpsmonitor-main.js`

## Build And Test Tarballs

```bash
bash scripts/build-npm-packages.sh
npm install -g ./dist/npm/sunjiehao-vpsmonitor-main-0.1.0.tgz
npm install -g ./dist/npm/sunjiehao-vpsmonitor-sub-0.1.0.tgz
vpsmonitor-main --help
vpsmonitor-sub --help
```

## Publish

```bash
bash scripts/publish-npm-packages.sh
```

After publishing, the runtime commands become:

```bash
npm i -g @sunjiehao/vpsmonitor-main
vpsmonitor-main install
vpsmonitor-main add-sub
vpsmonitor-main nodes
```

On each child VPS:

```bash
npm i -g @sunjiehao/vpsmonitor-sub
vpsmonitor-sub install
```
