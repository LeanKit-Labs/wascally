# RabbitMQ of Caerbannog
This is a very opinionated abstraction over amqplib to help simplify certain common tasks and (hopefully) reduce the effort required to use RabbitMQ in your Node services.

Features:
 * Gracefully handle re-connections
 * Automatically re-define all topology on re-connection
 * Automatically re-send any unconfirmed messages on re-connection
 * Support the majort of RabbitMQ's extensions
 * Handle batching of acknowledgements and rejections
 * Topology & configuration via the JSON configuration method (thanks to @JohnDMathis!)

Assumptions & Defaults:
 * Fault-tolerance/resilience over throughput
 * Default to publish confirmation
 * Default to ack mode on consumers
 * Heterogenous services that include statically typed languages
 * JSON as the only serialization provider

# API Reference
This library implements promises for many of the calls via when.js.

## Sending & Receiving Messages

### publish( exchangeName, options, [connectionName] )
This syntax allows you to provide arguments via an options object, here's an example showing all of the available properties:

```javascript
rabbit.publish( 'exchange.name', {
	routingKey: 'hi',
	type: 'company.project.messages.textMessage',
	correlationId: 'one',
	body: { text: 'hello!' },
	messageId: '100',
	expiration: '' // TTL in ms as a string
	timestamp: // posix timestamp (long)
	headers: {
		'random': 'application specific value'
	},
	connectionName: '' // another optional way to provide connection name if needed
} );
```

### publish( exchangeName, typeName, messageBody, [routingKey], [correlationId], [connectionName] )
Messages bodies are simple objects. You must provide a type specifier for the message which will be used to set AMQP's properties.type. If you don't provide a routing key, the type specifier will be used. If this is undesirable, you will have to provide a '' for the routing key argument/option.

```javascript
// the first 3 arguments are required
// routing key is optional and defaults to the value of typeName
// connectionName is only needed if you have multiple connections to different servers or vhosts

rabbit.publish( 'log.entries', 'company.project.messages.logEntry', {
		date: Date.now(),
		level: logLevel,
		message: message
	}, 'log.' + logLevel, someValueToCorrelateBy );
```

### request( exchangeName, options, [connectionName] )
This works just like a publish except that the promise returned provides the response (or responses) from the other side.

```javascript
// when multiple responses are provided, all but the last will be provided via the .progress callback.
// the last/only reply will always be provided to the .then callback
rabbit.request( 'request.exchange', {
		// see publish example to see options for the outgoing message
	} )
	.progress( function( reply ) {
		// if multiple replies are provided, all but the last will be sent via the progress callback
	} )
	.then( function( final ) {
		// the last message in a series OR the only reply will be sent to this callback
	} );
```

### handle( typeName, handler, [context] )
Message handlers are registered to handle a message based on the typeName. Calling handle will return a reference to the handler that can later be removed (though it's unlikely you'll do this often). The message that is passed to the handler is the raw Rabbit payload. The body property contains the message body published. 'ack' and 'nack' methods are provided on the message as well to allow you to easily acknowledge successful handling or reject the message.

```javascript
var handler = rabbit.handle( 'company.project.messages.logEntry', function( message ) {
	try {
		// do something meaningful?
		console.log( message.body );
		message.ack();
	} catch( err ) {
		message.nack();
	}
} );

handler.remove();
```

### startSubscription( queueName, [connectionName] )
Starts a consumer on the queue specified. connectionName is optional and only required if you're subscribing to a queue on a connection other than the default one.

## Message API
Caerbannog defaults to (and assumes) queues are in ack mode. It batches ack and nack operations in order to improve total throughput. Ack/Nack calls do not take effect immediately.

### message.ack()
Enqueues the message for acknowledgement.

### message.nack()
Enqueues the message for rejection. This will re-enqueue the message. Rejection of messages that aren't returned to the queue aren't supported *yet*.

### message.reply( message, [more], [replyType] )
The message is just the reply body. Providing true to more will cause the message to get sent to the .progress callback of the request promise so that you can send multiple replies. To control the replyType of the message, provide it as the last argument.

## Managing Topology

### addExchange( exchangeName, exchangeType, [options], [connectionName] )
The call returns a promise that can be used to determine when the exchange has been created on the server.

Valid exchangeTypes:
 * 'direct'
 * 'fanout'
 * 'topic'

Options is a hash that can contain the following:
 * autoDelete		true|false		delete when consumer count goes to 0
 * durable 			true|false		survive broker restarts
 * persistent 		true|false		a.k.a. persistent delivery, messages saved to disk
 * alternate 		'alt.exchange'	define an alternate exchange

### addQueue( queueName, [options], [connectionName] )
The call returns a promise that can be used to determine when the queue has been created on the server.

Options is a hash that can contain the following:
 * autoDelete		true|false		delete when consumer count goes to 0
 * durable 			true|false		survive broker restarts
 * exclusive		true|false		limits queue to the current connection only (danger)
 * subscribe		true|false		auto-start the subscription
 * limit 			2^16			max number of unacked messages allowed for consumer
 * queueLimit		2^32			max number of ready messages a queue can hold
 * messageTtl		2^32			time in ms before a message expires on the queue
 * expires			2^32			time in ms before a queue with 0 consumers expires
 * deadLetter 		'dlx.exchange'	the exchange to dead-letter messages to

### bindExchange( sourceExchange, targetExchange, [routingKeys], [connectionName] )
Binds the target exchange to the source exchange. Messages flow from source to target.

### bindQueue( sourceExchange, targetQueue, [routingKeys], [connectionName] )
Binds the target queue to the source exchange. Messages flow from source to target.

## Configuration via JSON
This example shows most of the available options described above.
```javascript
	var settings = {
		connection: {
			user: 'guest',
			pass: 'guest',
			server: '127.0.0.1',
			port: 5672,
			vhost: '%2fmyhost'
			},
		exchanges:[
			{ name: 'config-ex.1', type: 'fanout'  },
			{ name: 'config-ex.2', type: 'topic', alternate: 'alternate-ex.2', persistent: true }
			{ name: 'dead-letter-ex.2', type: 'fanout' }
			],
		queues:[
			{ name:'config-q.1', limit: 100, queueLimit: 1000 },
			{ name:'config-q.2', subscribe: true, deadLetter: 'dead-letter-ex.2' }
			],
		bindings:[
			{ exchange: 'config-ex.1', target: 'config-q.1', keys: [ 'bob','fred' ] },
			{ exchange: 'config-ex.2', target: 'config-q.2', keys: 'test1' }
		]
	};
```

To establish a connection with all settings in place and ready to go call configure:
```javascript
	var rabbit = require( 'caerbannog' );

	rabbit.configure( settings ).done( function() {
		// ready to go!
	} );
```

## AMQPS, SSL/TLS Support
Providing the following configuration options setting the related environment varibles will cause Caerbannog to attempt connecting via AMQPS. For more details about which settings perform what role, refer to the amqplib's page on [SSL](http://www.squaremobius.net/amqp.node/doc/ssl.html).

```javascript
	connection: { 		// sample connection hash
		caPath: '', 	// comma delimited paths to CA files. RABBIT_CA
		certPath: '', 	// path to cert file. RABBIT_CERT
		keyPath: '',	// path to key file. RABBIT_KEY
		passphrase: '', // passphrase associated with cert/pfx. RABBIT_PASSPHRASE
		pfxPath: ''		// path to pfx file. RABBIT_PFX
	}
```
