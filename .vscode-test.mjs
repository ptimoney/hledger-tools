import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/tests/*.vsTest.js',
	launchArgs: ['--disable-extensions']
});
