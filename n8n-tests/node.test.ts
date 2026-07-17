import { expect, test } from 'bun:test';
import { Dlvr } from '../n8n/nodes/Dlvr/Dlvr.node';

test('node exposes the complete delivery operation set and AI tool support', () => {
	const description = new Dlvr().description;
	expect(description.usableAsTool).toBe(true);
	const operation = description.properties.find(({ name }) => name === 'operation');
	expect(operation?.options?.map(({ value }) => value)).toEqual(['create', 'delete', 'download', 'get', 'list']);
});

test('package metadata matches the dedicated Creator Portal repository', async () => {
	const packageJson = await Bun.file(new URL('../n8n/package.json', import.meta.url)).json();
	const codex = await Bun.file(
		new URL('../n8n/nodes/Dlvr/Dlvr.node.json', import.meta.url),
	).json();
	const credential = await Bun.file(
		new URL('../n8n/credentials/DlvrApi.credentials.ts', import.meta.url),
	).text();

	expect(packageJson.repository).toEqual({
		type: 'git',
		url: 'https://github.com/dlvr-sh/n8n-nodes-dlvr.git',
	});
	expect(packageJson.scripts.test).toBeUndefined();
	expect(codex.node).toBe(packageJson.name);
	expect(codex.categories).toEqual(['Data & Storage', 'Development']);
	expect(codex.resources.credentialDocumentation).toEqual([
		{ url: 'https://dlvr.sh/docs/n8n/#credentials' },
	]);
	expect(credential).toContain("documentationUrl = 'https://dlvr.sh/docs/n8n/#credentials'");
});
