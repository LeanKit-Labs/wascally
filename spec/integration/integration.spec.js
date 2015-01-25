require( 'should' );
var _ = require( 'lodash' );
var rabbit = require( '../../src/index.js' );
var when = require( 'when' );
var seq = require( 'when/sequence' );

var harnessFn = function( cb, expected ) {
	var handlers = [];
	var received = [];
	var unhandled = [];
	expected = expected || 1;
	var check = function() {
		if ( received.length === expected ) {
			cb();
		}
	};

	function defaultHandle( message ) {
		message.ack();
	}

	function wrap( handle ) {
		return function( message ) {
			handle( message );
			received.push( message );
			check();
		};
	}

	function handle( type, handle ) {
		handlers.push( rabbit.handle( type, wrap( handle || defaultHandle ) ) );
	}

	function clean() {
		handlers.forEach( function( handle ) {
			handle.remove();
		} );
		handlers = [];
		received = [];
	}

	rabbit.onUnhandled( function( message ) {
		received.push( message );
		message.ack();
		check();
	} );

	return {
		add: function( msg ) {
			received.push( msg );
			check();
		},
		received: received,
		clean: clean,
		handle: handle,
		handlers: handlers
	};
};

describe( 'Integration Test Suite', function() {

	before( function( done ) {
		rabbit.configure( require( './configuration.js' ) )
			.then( function() {
				done();
			} );
	} );

	describe( 'with invalid connection criteria', function() {
		var error;
		before( function( done ) {
			rabbit.once( 'silly.connection.failed', function( err ) {
				error = err;
				done();
			} );

			rabbit.addConnection( {
				name: 'silly',
				server: 'shfifty-five.gov'
			} );
		} );

		it( 'should fail to connect', function() {
			error.should.equal( 'No endpoints could be reached' );
		} );

		after( function( done ) {
			rabbit.close( 'silly', true )
				.then( function() {
					done();
				} );
		} );
	} );

	describe( 'with topic routes', function() {
		var harness;
		before( function( done ) {
			harness = harnessFn( done, 3 );
			harness.handle( 'topic' );
			rabbit.publish( 'wascally-ex.topic', { type: 'topic', routingKey: 'this.is.a.test', body: 'broadcast' } );
			rabbit.publish( 'wascally-ex.topic', { type: 'topic', routingKey: 'this.is.sparta', body: 'leonidas' } );
			rabbit.publish( 'wascally-ex.topic', { type: 'topic', routingKey: 'a.test.this.is', body: 'yoda' } );
		} );

		it( 'should route all messages correctly', function() {
			var results = _.map( harness.received, function( m ) {
				return {
					body: m.body,
					key: m.fields.routingKey
				};
			} );
			_.sortBy( results, 'body' ).should.eql(
				[
					{ body: 'broadcast', key: 'this.is.a.test' },
					{ body: 'leonidas', key: 'this.is.sparta' },
					{ body: 'yoda', key: 'a.test.this.is' },
				] );
		} );

		after( function() {
			harness.clean();
		} );
	} );

	describe( 'with fanout exchange', function() {
		var harness;
		before( function( done ) {
			harness = harnessFn( done, 2 );
			harness.handle( 'fanned' );
			rabbit.publish( 'wascally-ex.fanout', { type: 'fanned', routingKey: 'this.is.ignored', body: 'hello, everyone' } );
		} );

		it( 'should route all messages correctly', function() {
			var results = _.map( harness.received, function( m ) {
				return {
					body: m.body,
					key: m.fields.routingKey
				};
			} );
			results.should.eql(
				[
					{ body: 'hello, everyone', key: 'this.is.ignored' },
					{ body: 'hello, everyone', key: 'this.is.ignored' }
				] );
		} );

		after( function() {
			harness.clean();
		} );
	} );

	describe( 'with unhandled messages', function() {
		var harness;
		before( function( done ) {
			harness = harnessFn( done, 2 );
			rabbit.publish( 'wascally-ex.direct', { type: 'junk', routingKey: '', body: 'uh oh' } );
			rabbit.publish( 'wascally-ex.direct', { type: 'garbage', routingKey: '', body: 'uh oh' } );
		} );

		it( 'should capture messages according to unhandled strategy', function() {
			var results = _.map( harness.received, function( m ) {
				return {
					body: m.body,
					type: m.type
				};
			} );
			results.should.eql(
				[
					{ body: 'uh oh', type: 'junk' },
					{ body: 'uh oh', type: 'garbage' }
				] );
		} );

		after( function() {
			harness.clean();
		} );
	} );

	describe( 'with unrouted messages', function() {
		var harness;
		before( function( done ) {
			harness = harnessFn( done, 3 );
			harness.handle( 'deadend' );
			rabbit.publish( 'wascally-ex.deadend', { type: 'deadend', routingKey: 'empty', body: 'one' } );
			rabbit.publish( 'wascally-ex.deadend', { type: 'deadend', routingKey: 'nothing', body: 'two' } );
			rabbit.publish( 'wascally-ex.deadend', { type: 'deadend', routingKey: 'de.nada', body: 'three' } );
		} );

		it( 'should route all messages correctly', function() {
			var results = _.map( harness.received, function( m ) {
				return {
					body: m.body,
					key: m.fields.routingKey
				};
			} );
			results.should.eql(
				[
					{ body: 'one', key: 'empty' },
					{ body: 'two', key: 'nothing' },
					{ body: 'three', key: 'de.nada' },
				] );
		} );

		after( function() {
			harness.clean();
		} );
	} );

	describe( 'with requests', function() {
		var harness, response1, response2, response3;
		before( function( done ) {
			harness = harnessFn( done, 8 );
			harness.handle( 'polite', function( q ) {
				q.reply( ':D' );
			} );
			harness.handle( 'rude', function( q ) {
				q.reply( '>:@' );
			} );
			harness.handle( 'crazy', function( q ) {
				q.reply( '...', true );
				q.reply( '...', true );
				q.reply( '...' );
			} );

			rabbit.request( 'wascally-ex.request', { type: 'polite', body: 'how are you?' } )
				.then( function( response ) {
					response1 = response.body;
					harness.add( response );
				} );

			rabbit.request( 'wascally-ex.request', { type: 'rude', body: 'why so dumb?' } )
				.then( function( response ) {
					response2 = response.body;
					harness.add( response );
				} );

			function onPart( part ) {
				response3 = ( response3 || '' ) + part.body;
				harness.add( part );
			}
			rabbit.request( 'wascally-ex.request', { type: 'crazy', body: 'do you like my yak-hair-shirt?' } )
				.progress( onPart )
				.then( function( response ) {
					onPart( response );
				} );
		} );

		it( 'should handle all requests', function() {
			var results = _.map( harness.received, function( m ) {
				return {
					body: m.body
				};
			} );
			_.sortBy( results, 'body' ).should.eql(
				[
					{ body: '...' },
					{ body: '...' },
					{ body: '...' },
					{ body: ':D' },
					{ body: '>:@' },
					{ body: 'do you like my yak-hair-shirt?' },
					{ body: 'how are you?' },
					{ body: 'why so dumb?' },
				] );
		} );

		it( 'should capture responses corresponding to the originating request', function() {
			response1.should.equal( ':D' );
			response2.should.equal( '>:@' );
			response3.should.equal( '.........' );
		} );

		after( function() {
			harness.clean();
		} );
	} );

	describe( 'with rejection and dead-letter', function() {
		var harness;
		before( function( done ) {
			harness = harnessFn( done, 2 );
			harness.handlers.push(
				rabbit.handle( 'reject', function( env ) {
					if ( harness.received.length < 2 ) {
						env.reject();
					} else {
						env.ack();
					}
					harness.add( env );
				} )
			);
			rabbit.publish( 'wascally-ex.topic', { type: 'reject', routingKey: 'this.is.rejection', body: 'haters gonna hate' } );
		} );

		it( 'receive message from bound queue and dead-letter queue', function() {
			var results = _.map( harness.received, function( m ) {
				return {
					body: m.body,
					key: m.fields.routingKey,
					exchange: m.fields.exchange
				};
			} );
			results.should.eql(
				[
					{ body: 'haters gonna hate', key: 'this.is.rejection', exchange: 'wascally-ex.topic' },
					{ body: 'haters gonna hate', key: 'this.is.rejection', exchange: 'wascally-ex.deadletter' }
				] );
		} );

		after( function() {
			harness.clean();
		} );
	} );

	describe( 'with consistent hash exchange', function() {
		var harness, limit;
		before( function( done ) {
			this.timeout( 60000 );
			limit = 1000;
			harness = harnessFn( done, limit );
			harness.handle( 'balanced' );
			for (var i = 0; i < limit; i++) {
				rabbit.publish( 'wascally-ex.consistent-hash', { type: 'balanced', correlationId: ( i + i ).toString(), body: 'message ' + i } );
			}
		} );

		it( 'should distribute messages across queues within margin for error', function() {
			var consumers = _.reduce( harness.received, function( acc, m ) {
				var key = m.fields.consumerTag;
				if ( acc[ key ] ) {
					acc[key]++;
				} else {
					acc[ key ] = 1;
				}
				return acc;
			}, {} );
			var quarter = limit / 4;
			var margin = quarter / 4;
			var counts = _.values( consumers );
			_.each( counts, function( count ) {
				count.should.be.approximately( quarter, margin );
			} );
			_.reduce( counts, function( acc, x ) {
				return acc + x;
			}, 0 ).should.equal( limit );
		} );

		after( function() {
			harness.clean();
		} );
	} );

	describe( '', function() {} );

	after( function( done ) {
		rabbit.deleteExchange( 'wascally-ex.deadend' ).then( function() {
			rabbit.close( 'default', true )
				.then( function() {
					done();
				} );
		} );
	} );

} );