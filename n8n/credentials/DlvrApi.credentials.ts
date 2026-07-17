import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class DlvrApi implements ICredentialType {
	name = 'dlvrApi';

	displayName = 'dlvr.sh API';

	icon: Icon = { light: 'file:../nodes/Dlvr/dlvr.svg', dark: 'file:../nodes/Dlvr/dlvr.dark.svg' };

	documentationUrl = 'https://dlvr.sh/account/api/';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			placeholder: 'dlvr_...',
			description: 'Create a paid-plan API key in the dlvr.sh dashboard',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://dlvr.sh',
			url: '/api/cli/config',
			method: 'GET',
		},
	};
}
