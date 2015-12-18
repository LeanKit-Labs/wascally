module.exports = {
	connection: {
		name: 'default',
		user: 'guest',
		pass: 'guest',
		server: '127.0.0.1',
		port: 5672,
		vhost: '%2f',
		replyQueue: false
	},
	exchanges: [
		{
			name: 'noreply-ex.direct.noParse',
			type: 'direct',
			autoDelete: true
		},
		{
			name: 'noreply-ex.direct',
			type: 'direct',
			autoDelete: true
		}
	],

	queues: [
		{
			name: 'noreply-q.direct.noParse',
			autoDelete: true,
			noParse: true,
			subscribe: true
		},
		{
			name: 'noreply-q.direct',
			autoDelete: true,
			subscribe: true
		}
	],

	bindings: [
		{
			exchange: 'noreply-ex.direct.noParse',
			target: 'noreply-q.direct.noParse',
			keys: ''
		},
		{
			exchange: 'noreply-ex.direct',
			target: 'noreply-q.direct',
			keys: ''
		}
	]
};
