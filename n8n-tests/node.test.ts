import { expect, test } from 'bun:test';
import { Dlvr } from '../n8n/nodes/Dlvr/Dlvr.node';

test('node exposes the complete delivery operation set and AI tool support', () => {
	const description = new Dlvr().description;
	expect(description.usableAsTool).toBe(true);
	const operation = description.properties.find(({ name }) => name === 'operation');
	expect(operation?.options?.map(({ value }) => value)).toEqual(['create', 'delete', 'download', 'get', 'list']);
});

test('credential source remains discoverable by the n8n Creator Portal', async () => {
	const canonical = await Bun.file(
		new URL('../n8n/credentials/DlvrApi.credentials.ts', import.meta.url),
	).text();
	const discoverable = await Bun.file(
		new URL('../credentials/DlvrApi.credentials.ts', import.meta.url),
	).text();

	expect(discoverable).toBe(canonical);
});
