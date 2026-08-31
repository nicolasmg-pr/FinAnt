// Monorepo Metro config: without the watchFolders and nodeModulesPaths below,
// Metro resolves only apps/mobile/node_modules and every @finant/* import fails.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// npm workspaces hoists, so a package must not be resolved twice from two trees.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
