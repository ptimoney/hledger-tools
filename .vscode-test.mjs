import { defineConfig } from '@vscode/test-cli';

export default defineConfig([
	{
	files: 'out/testing/errorChecking/extension.vsTest.js',
	workspaceFolder: './src/testing/errorChecking/testingWorkspace',
	launchArgs: ['--disable-extensions']
	}
]);
