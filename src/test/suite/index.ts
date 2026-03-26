import path from 'path';
import { glob } from 'glob';
import Mocha from 'mocha';

export async function run(): Promise<void> {
	const mocha = new Mocha({
		ui: 'tdd',
		color: true
	});

	const testsRoot = path.resolve(__dirname, '..');

	const files = await glob('**/**.test.js', { cwd: testsRoot });

	// Add files to the test suite
	files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));

	return new Promise((c, e) => {
		try {
			// Run the mocha test
			mocha.run((failures: number) => {
				if (failures > 0) {
					e(new Error(`${failures} tests failed.`));
				} else {
					c();
				}
			});
		} catch (err) {
			console.error(err);
			e(err);
		}
	});
}
