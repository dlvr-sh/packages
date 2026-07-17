import type {
	IBinaryData,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { prepareBinarySource, prepareUrlSource, type BinaryDescriptor } from './sources';
import {
	createDelivery,
	deleteDelivery,
	downloadShare,
	DlvrRequestError,
	getCliConfig,
	getDelivery,
	listDeliveries,
	type UploadSummary,
	type DlvrCredentials,
} from './transport';

const FALLBACK_DURATIONS: INodePropertyOptions[] = [
	{ name: '1 Hour', value: '1h' },
	{ name: '24 Hours', value: '24h' },
	{ name: '3 Days', value: '3d' },
	{ name: '7 Days', value: '7d' },
	{ name: '14 Days', value: '14d' },
	{ name: '30 Days', value: '30d' },
];

function errorDetails(error: unknown) {
	if (error instanceof DlvrRequestError) {
		return {
			message: error.message,
			code: error.code,
			status: error.status,
		};
	}
	return { message: error instanceof Error ? error.message : String(error) };
}

function throwNodeError(context: IExecuteFunctions, error: unknown, itemIndex: number): never {
	const details = errorDetails(error);
	throw new NodeOperationError(context.getNode(), details.message, {
		itemIndex,
		description: [details.code, details.status ? `HTTP ${details.status}` : undefined]
			.filter(Boolean)
			.join(' · ') || undefined,
	});
}

function parseEmails(value: string) {
	return value
		.split(/[\n,]/)
		.map((email) => email.trim())
		.filter(Boolean);
}

function hashString(value: string) {
	let first = 2166136261;
	let second = 2246822507;
	for (let index = 0; index < value.length; index += 1) {
		first ^= value.charCodeAt(index);
		first = Math.imul(first, 16777619);
		second ^= value.charCodeAt(index);
		second = Math.imul(second, 3266489909);
	}
	return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}

function descriptorIdentity(descriptor: BinaryDescriptor) {
	return descriptor.id
		? `${descriptor.id}:${descriptor.size}:${descriptor.name}`
		: `${descriptor.size}:${descriptor.inline?.subarray(0, 64).toString('base64') ?? ''}:${descriptor.name}`;
}

function idempotencyKey(input: {
	executionId: string;
	nodeId: string;
	itemIndex: number;
	sources: string[];
	settings: Record<string, unknown>;
}) {
	const digest = hashString(JSON.stringify(input));
	return `n8n-${digest}`;
}

async function binaryDescriptor(
	context: IExecuteFunctions,
	itemIndex: number,
	propertyName: string,
) {
	const binary = context.helpers.assertBinaryData(itemIndex, propertyName);
	let inline: Buffer | undefined;
	let size = Number(binary.bytes);
	if (binary.id) {
		if (!Number.isFinite(size) || size < 0) {
			size = (await context.helpers.getBinaryMetadata(binary.id)).fileSize;
		}
	} else {
		inline = await context.helpers.getBinaryDataBuffer(itemIndex, binary);
		size = inline.length;
	}
	if (!Number.isFinite(size) || size < 0) {
		throw new NodeOperationError(context.getNode(), `Could not determine the size of binary property '${propertyName}'.`, {
			itemIndex,
		});
	}
	return {
		name: binary.fileName?.trim() || propertyName || 'file',
		size,
		type: binary.mimeType || 'application/octet-stream',
		id: binary.id,
		inline,
	} satisfies BinaryDescriptor;
}

function outputError(input: INodeExecutionData, error: unknown, itemIndex: number): INodeExecutionData {
	return {
		json: { ...input.json, error: errorDetails(error) },
		pairedItem: itemIndex,
	};
}

export class Dlvr implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'dlvr.sh',
		name: 'dlvr',
		icon: { light: 'file:dlvr.svg', dark: 'file:dlvr.dark.svg' },
		group: ['input', 'output'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Create, sell, manage, and download temporary file deliveries',
		defaults: { name: 'dlvr.sh' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'dlvrApi',
				required: true,
				displayOptions: { show: { operation: ['create', 'list', 'get', 'delete'] } },
			},
		],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'create',
				options: [
					{ name: 'Create Delivery', value: 'create', action: 'Create a delivery' },
					{ name: 'Delete Delivery', value: 'delete', action: 'Delete a delivery' },
					{ name: 'Download Share', value: 'download', action: 'Download a public share' },
					{ name: 'Get Delivery', value: 'get', action: 'Get a delivery' },
					{ name: 'Get Many Deliveries', value: 'list', action: 'Get many deliveries' },
				],
			},
			{
				displayName: 'Source',
				name: 'sourceMode',
				type: 'options',
				default: 'binary',
				options: [
					{ name: 'Binary Data', value: 'binary', description: 'Upload binary data from a previous node' },
					{ name: 'Public HTTPS URL', value: 'url', description: 'Upload a file from a public range-capable URL' },
				],
				displayOptions: { show: { operation: ['create'] } },
			},
			{
				displayName: 'Binary Selection',
				name: 'binarySelection',
				type: 'options',
				default: 'single',
				options: [
					{ name: 'All Binary Properties', value: 'all' },
					{ name: 'One Property', value: 'single' },
				],
				displayOptions: { show: { operation: ['create'], sourceMode: ['binary'] } },
			},
			{
				displayName: 'Input Binary Field',
				name: 'binaryProperty',
				type: 'string',
				default: 'data',
				description: 'Name of the input field containing the binary file',
				displayOptions: {
					show: { operation: ['create'], sourceMode: ['binary'], binarySelection: ['single'] },
				},
			},
			{
				displayName: 'Source URL',
				name: 'sourceUrl',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'https://example.com/artifact.zip',
				description: 'Public HTTPS URL; private and local network destinations are rejected',
				displayOptions: { show: { operation: ['create'], sourceMode: ['url'] } },
			},
			{
				displayName: 'Filename',
				name: 'urlFilename',
				type: 'string',
				default: '',
				description: 'Optional filename override; otherwise inferred from the response or URL',
				displayOptions: { show: { operation: ['create'], sourceMode: ['url'] } },
			},
			{
				displayName: 'Content Type',
				name: 'urlContentType',
				type: 'string',
				default: '',
				placeholder: 'application/zip',
				description: 'Optional MIME type override',
				displayOptions: { show: { operation: ['create'], sourceMode: ['url'] } },
			},
			{
				displayName: 'Expiry Type',
				name: 'expiryMode',
				type: 'options',
				default: 'duration',
				options: [
					{ name: 'Duration', value: 'duration' },
					{ name: 'Fixed Date', value: 'fixedDate' },
				],
				displayOptions: { show: { operation: ['create'] } },
			},
			{
				displayName: 'Duration Name or ID',
				name: 'duration',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getDurationOptions' },
				default: '24h',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				displayOptions: { show: { operation: ['create'], expiryMode: ['duration'] } },
			},
			{
				displayName: 'Expires At',
				name: 'expiresAt',
				type: 'dateTime',
				default: '',
				required: true,
				description: 'Expiry with an explicit timezone, within the current plan limit',
				displayOptions: { show: { operation: ['create'], expiryMode: ['fixedDate'] } },
			},
			{
				displayName: 'Password',
				name: 'password',
				type: 'string',
				typeOptions: { password: true },
				default: '',
				description: 'Optional password required from downloaders',
				displayOptions: { show: { operation: ['create'] } },
			},
			{
				displayName: 'Maximum Downloads',
				name: 'maxDownloads',
				type: 'number',
				typeOptions: { minValue: 0, maxValue: 10000 },
				default: 0,
				description: 'Use 0 for unlimited downloads',
				displayOptions: { show: { operation: ['create'] } },
			},
			{
				displayName: 'Notification Emails',
				name: 'notifyEmails',
				type: 'string',
				default: '',
				placeholder: 'client@example.com, team@example.com',
				description: 'Up to three comma-separated addresses notified when the delivery is ready',
				displayOptions: { show: { operation: ['create'] } },
			},
			{
				displayName: 'Sell This Delivery',
				name: 'paidEnabled',
				type: 'boolean',
				default: false,
				description: 'Whether to sell access to this delivery; requires completed Stripe Connect onboarding and accepted seller terms in dlvr.sh',
				displayOptions: { show: { operation: ['create'] } },
			},
			{
				displayName: 'Price (USD)',
				name: 'priceUsd',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 10000, numberPrecision: 2 },
				default: 9,
				description: 'Buyer price before applicable tax; dlvr.sh retains its documented application fee',
				displayOptions: { show: { operation: ['create'], paidEnabled: [true] } },
			},
			{
				displayName: 'Stripe Tax Code',
				name: 'taxCode',
				type: 'string',
				default: 'txcd_10000000',
				description: 'Stripe product tax code for the sold file',
				displayOptions: { show: { operation: ['create'], paidEnabled: [true] } },
			},
			{
				displayName: 'Delivery ID',
				name: 'deliveryId',
				type: 'string',
				default: '',
				required: true,
				description: 'Account delivery ID, not the public share ID',
				displayOptions: { show: { operation: ['get', 'delete'] } },
			},
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: true,
				description: 'Whether to return all results or only up to a given limit',
				displayOptions: { show: { operation: ['list'] } },
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 1000 },
				default: 50,
				description: 'Max number of results to return',
				displayOptions: { show: { operation: ['list'], returnAll: [false] } },
			},
			{
				displayName: 'Share ID or URL',
				name: 'share',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'https://dlvr.sh/f/abc123',
				description: 'Public share ID or full dlvr.sh share URL',
				displayOptions: { show: { operation: ['download'] } },
			},
			{
				displayName: 'Share Password',
				name: 'sharePassword',
				type: 'string',
				typeOptions: { password: true },
				default: '',
				displayOptions: { show: { operation: ['download'] } },
			},
			{
				displayName: 'Output Binary Field',
				name: 'outputBinaryProperty',
				type: 'string',
				default: 'data',
				description: 'Field in which to place the downloaded file',
				displayOptions: { show: { operation: ['download'] } },
			},
		],
	};

	methods = {
		loadOptions: {
			async getDurationOptions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				try {
					const credentials = await this.getCredentials<DlvrCredentials>('dlvrApi');
					const config = await getCliConfig(this.helpers.httpRequest, credentials);
					const options = config.expiry?.durationOptions
						?.filter((option) => option.enabled)
						.map((option) => ({ name: option.label, value: option.value }));
					return options?.length ? options : FALLBACK_DURATIONS;
				} catch {
					return FALLBACK_DURATIONS;
				}
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const operation = this.getNodeParameter('operation', 0) as string;
		const signal = this.getExecutionCancelSignal();

		if (operation === 'list') {
			try {
				const credentials = await this.getCredentials<DlvrCredentials>('dlvrApi');
				const returnAll = this.getNodeParameter('returnAll', 0) as boolean;
				const requested = returnAll ? Number.POSITIVE_INFINITY : (this.getNodeParameter('limit', 0) as number);
				const uploads: UploadSummary[] = [];
				let offset = 0;
				while (uploads.length < requested) {
					const pageSize = Math.min(100, requested - uploads.length);
					const result = await listDeliveries(this.helpers.httpRequest, credentials, { limit: pageSize, offset }, signal);
					uploads.push(...result.uploads);
					if (result.uploads.length < pageSize || result.nextOffset == null) break;
					offset = result.nextOffset;
				}
				return [uploads.map((upload) => ({ json: { ...upload }, pairedItem: 0 }))];
			} catch (error) {
				if (this.continueOnFail()) return [[outputError(items[0] ?? { json: {}, pairedItem: 0 }, error, 0)]];
				throwNodeError(this, error, 0);
			}
		}

		const output: INodeExecutionData[] = [];
		for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
			try {
				if (operation === 'create') {
					const credentials = await this.getCredentials<DlvrCredentials>('dlvrApi', itemIndex);
					const sourceMode = this.getNodeParameter('sourceMode', itemIndex) as string;
					const sourceIdentities: string[] = [];
					const prepared = [];

					if (sourceMode === 'url') {
						const sourceUrl = this.getNodeParameter('sourceUrl', itemIndex) as string;
						prepared.push(
							await prepareUrlSource(
								this.helpers.httpRequest,
								sourceUrl,
								{
									filename: this.getNodeParameter('urlFilename', itemIndex, '') as string,
									contentType: this.getNodeParameter('urlContentType', itemIndex, '') as string,
								},
								signal,
							),
						);
						sourceIdentities.push(sourceUrl);
					} else {
						const selection = this.getNodeParameter('binarySelection', itemIndex) as string;
						const propertyNames =
							selection === 'all'
								? Object.keys(items[itemIndex]?.binary ?? {}).sort()
								: [this.getNodeParameter('binaryProperty', itemIndex) as string];
						if (propertyNames.length === 0) {
							throw new NodeOperationError(this.getNode(), 'The input item has no binary properties.', { itemIndex });
						}
						if (propertyNames.length > 100) {
							throw new NodeOperationError(this.getNode(), 'A delivery can contain at most 100 files.', { itemIndex });
						}
						for (const propertyName of propertyNames) {
							const descriptor = await binaryDescriptor(this, itemIndex, propertyName);
							prepared.push(prepareBinarySource(descriptor, this.helpers, signal));
							sourceIdentities.push(descriptorIdentity(descriptor));
						}
					}

					const expiryMode = this.getNodeParameter('expiryMode', itemIndex) as string;
					const duration = expiryMode === 'duration' ? (this.getNodeParameter('duration', itemIndex) as string) : undefined;
					const expiresAt = expiryMode === 'fixedDate' ? (this.getNodeParameter('expiresAt', itemIndex) as string) : undefined;
					const password = (this.getNodeParameter('password', itemIndex, '') as string).trim() || undefined;
					const rawMaxDownloads = this.getNodeParameter('maxDownloads', itemIndex, 0) as number;
					const maxDownloads = rawMaxDownloads > 0 ? rawMaxDownloads : undefined;
					const notifyEmails = parseEmails(this.getNodeParameter('notifyEmails', itemIndex, '') as string);
					if (notifyEmails.length > 3) {
						throw new NodeOperationError(this.getNode(), 'At most three notification email addresses are allowed.', {
							itemIndex,
						});
					}
					const paidEnabled = this.getNodeParameter('paidEnabled', itemIndex, false) as boolean;
					const priceUsd = paidEnabled ? (this.getNodeParameter('priceUsd', itemIndex) as number) : undefined;
					const taxCode = paidEnabled ? (this.getNodeParameter('taxCode', itemIndex) as string) : undefined;
					const settings = { duration, expiresAt, password, maxDownloads, notifyEmails, paidEnabled, priceUsd, taxCode };
					const result = await createDelivery({
						request: this.helpers.httpRequest,
						credentials,
						sources: prepared.map(({ source }) => source),
						duration,
						expiresAt,
						password,
						maxDownloads,
						notifyEmails,
						paidEnabled,
						priceUsd,
						taxCode,
						idempotencyKey: idempotencyKey({
							executionId: this.getExecutionId(),
							nodeId: this.getNode().id,
							itemIndex,
							sources: sourceIdentities,
							settings,
						}),
						concurrency: Math.min(...prepared.map(({ concurrency }) => concurrency)),
						signal,
					});
					output.push({ json: { ...result }, pairedItem: itemIndex });
					continue;
				}

				if (operation === 'get') {
					const credentials = await this.getCredentials<DlvrCredentials>('dlvrApi', itemIndex);
					const id = this.getNodeParameter('deliveryId', itemIndex) as string;
					const result = await getDelivery(this.helpers.httpRequest, credentials, id, signal);
					output.push({ json: { ...result.upload }, pairedItem: itemIndex });
					continue;
				}

				if (operation === 'delete') {
					const credentials = await this.getCredentials<DlvrCredentials>('dlvrApi', itemIndex);
					const id = this.getNodeParameter('deliveryId', itemIndex) as string;
					await deleteDelivery(this.helpers.httpRequest, credentials, id, signal);
					output.push({ json: { id, deleted: true }, pairedItem: itemIndex });
					continue;
				}

				if (operation === 'download') {
					const share = this.getNodeParameter('share', itemIndex) as string;
					const password = this.getNodeParameter('sharePassword', itemIndex, '') as string;
					const propertyName = this.getNodeParameter('outputBinaryProperty', itemIndex) as string;
					const result = await downloadShare(this.helpers.httpRequest, share, password, signal);
					if (!result.response.body) {
						throw new NodeOperationError(this.getNode(), 'Download response did not contain a file body.', { itemIndex });
					}
					const contentType = String(result.response.headers['content-type'] || 'application/octet-stream');
					const binary = await this.helpers.prepareBinaryData(result.response.body as never, result.filename, contentType);
					output.push({
						json: { ...result.metadata },
						binary: { [propertyName]: binary as IBinaryData },
						pairedItem: itemIndex,
					});
					continue;
				}

				throw new NodeOperationError(this.getNode(), `Unsupported operation: ${operation}`, { itemIndex });
			} catch (error) {
				if (this.continueOnFail()) output.push(outputError(items[itemIndex]!, error, itemIndex));
				else throwNodeError(this, error, itemIndex);
			}
		}

		return [output];
	}
}
