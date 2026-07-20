import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const codex = JSON.parse(
	await readFile(new URL('../nodes/Dlvr/Dlvr.node.json', import.meta.url), 'utf8'),
);
const credentialSource = await readFile(
	new URL('../credentials/DlvrApi.credentials.ts', import.meta.url),
	'utf8',
);

const publicCredentialDocs = 'https://dlvr.sh/docs/n8n/#credentials';
const allowedCategories = new Set([
	'Analytics',
	'Communication',
	'Data & Storage',
	'Development',
	'Finance & Accounting',
	'Marketing & Content',
	'Miscellaneous',
	'Productivity',
	'Sales',
	'Utility',
]);

assert.equal(packageJson.name, '@dlvr/n8n-nodes-dlvr');
assert.deepEqual(packageJson.repository, {
	type: 'git',
	url: 'https://github.com/dlvr-sh/packages.git',
	directory: 'n8n',
});
assert.equal(packageJson.scripts.test, undefined, 'Do not expose a test script that needs monorepo files');
assert.equal(codex.node, packageJson.name, 'Community-node codex ID must equal the npm package name');
assert.ok(
	codex.categories.every((category) => allowedCategories.has(category)),
	'Codex includes an unsupported n8n category',
);
assert.deepEqual(codex.resources.credentialDocumentation, [{ url: publicCredentialDocs }]);
assert.match(credentialSource, new RegExp(`documentationUrl = '${publicCredentialDocs}'`));
assert.doesNotMatch(credentialSource, /dlvr\.sh\/account\//);

console.log('n8n package metadata is valid');
