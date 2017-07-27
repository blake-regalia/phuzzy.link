
/**

/browse/:source

/configs

/config/:source

/plugin/:plugin
/plugin/:plugin/js
/plugin/:plugin/css

/pack/:pack
/pack/:pack/js
/pack/:pack/css

**/


const path = require('path');
const stream = require('stream');
const fs = require('fs');
const child_process = require('child_process');
const url = require('url');
const dns = require('dns');

// third-party modules
const async = require('async');
const browserify = require('browserify');
const h_argv = require('minimist')(process.argv.slice(2));
const mkdirp = require('mkdirp');
// const classer = require('classer');
const express = require('express');
require('express-negotiate');
const body_parser = require('body-parser');
const less_middleware = require('less-middleware');
const browserify_middleware = require('browserify-middleware');
const request = require('request');
const pg = require('pg');

const N_PORT = h_argv.p || h_argv.port || 80;

const _404 = (d_res) => {
	d_res.status(404).end('No such geometry');
};

const P_DIR_PLUGINS = path.resolve(__dirname, '../..', 'plugins');
const P_DIR_FETCH = path.resolve(__dirname, '../..', 'fetch');

const H_PLUGIN_ASSET_TYPES = {
	js: {},
	css: {},
};

const X_MAX_PAYLOAD_SIZE = 16384;

// connect using environment variable
let k_pool = new pg.Pool();
let h_env = process.env;
if(!h_env.PGDATABASE) {
	throw 'you must specify a database using environment variable PGDATABASE -- and a user/password/port if needed';
}

// check status of an npm package
function check_npm_package(s_package, fk_check) {
	// read package.json contents
	fs.readFile(path.join(P_DIR_PLUGINS, 'package.json'), (e_read, s_package_json) => {
		// i/o error
		if(e_read) {
			return fk_check(e_read);
		}

		// parse package.json
		let h_package;
		try {
			h_package = JSON.parse(s_package_json);
		}
		catch(e_package) {
			return fk_check('corrupt package.json file');
		}

		// get package
		fk_check(null, h_package.dependencies[s_package]);
	});
}


// install an npm package
function install_npm_package(s_package, fk_install) {
	// check package first
	check_npm_package(s_package, (e_check, s_semver) => {
		// check error
		if(e_check) {
			return fk_install(e_check);
		}

		// package already installed
		if(s_semver) {
			fk_install(null, s_semver);
		}
		// package not installed
		else {
			// invoke npm install
			let u_npm = child_process.spawn('npm', ['i', '-S', s_package], {
				cwd: P_DIR_PLUGINS,
			});

			// spawn error
			u_npm.on('error', (e_spawn) => {
				fk_install(e_spawn);
			});

			// stdout data
			let s_stdout = '';
			u_npm.stdout.on('data', (s_data) => {
				s_stdout += s_data;
			});

			// stderr data
			let s_stderr = '';
			u_npm.stderr.on('data', (s_data) => {
				s_stderr += s_data;
			});

			// npm exitted
			u_npm.on('close', (n_code) => {
				// exitted gracefully
				if(0 === n_code) {
					fk_install(null, s_stdout);
				}
				// bad exit
				else {
					fk_install(s_stderr);
				}
			});
		}
	});
}

function fetch_package(s_plugin, d_res, fk_package) {
	install_npm_package(s_plugin, (e_install, s_data) => {
		// install error
		if(e_install) {
			return d_res.status(400).end('failed to install plugin '+e_install);
		}
		// package is ready
		else {
			// set its directory
			let p_dir_plugin = path.join(P_DIR_PLUGINS, 'node_modules', s_plugin);

			// fetch package.json's main field
			let h_package;
			try {
				h_package = require(path.join(p_dir_plugin, 'package.json'));
			}
			catch(e_package) {
				return d_res.status(500).end('failed to locate package.json in plugin');
			}

			// callback
			fk_package(h_package);
		}
	});
}

function resolve_endpoint(s_endpoint, d_res) {
	if(s_endpoint.startsWith('http://')) {
		d_res.redirect(301, s_endpoint.substr('http://'.length));
		return null;
	}

	if(/^\w+:\/\//.test(s_endpoint)) {
		let d_url;
		try {
			d_url = new url.URL(s_endpoint);
		}
		catch(e_url) {
			d_res.status(400).end('invalid endpoint URL');
			return null;
		}

		if('https:' === d_url.protocol) {
			d_res.status(501).end('support for https endpoints are not yet implemented');
		}
		else {
			d_res.status(400).end('only HTTP protocol is allowed for endpoint URLs');
		}

		return null;
	}

	return s_endpoint;
}


const k_app = express();

const P_DIR_WEBAPP = path.resolve(__dirname, '../../dist/webapp');
const R_SAFE_PATH = /^\w+$/;

function assert_safe_path(s_file, d_res) {
	if(!R_SAFE_PATH.test(s_file)) {
		d_res.status(400).end(`bad param name: '${s_file}'`);
	}
}

// middleware
k_app.use(body_parser.json({
	limit: X_MAX_PAYLOAD_SIZE,
}));

// views
k_app.set('views', path.resolve(__dirname, '../webapp/_layouts'));
k_app.set('view engine', 'pug');

// styles
k_app.use('/style', less_middleware(__dirname+'/../webapp/_styles', {
	dest: P_DIR_WEBAPP+'/_styles',
}));

// scripts
browserify_middleware.settings.development('minify', true);
browserify_middleware.settings.development('gzip', true);
k_app.use('/script', browserify_middleware(__dirname+'/../webapp/_scripts'));

// static routing
// k_app.use('/script', express.static(__dirname+'/../../dist/webapp/_scripts'));
k_app.use('/style', express.static(__dirname+'/../../dist/webapp/_styles'));
k_app.use('/resource', express.static(__dirname+'/../../lib/webapp/_resources'));
k_app.use('/fonts', express.static(__dirname+'/../../node_modules/font-awesome/fonts'));

// browse some source
k_app.get([
	'/browse',
	/^\/browse\/(?:(\w+):\/\/)?(.+)/,
], (d_req, d_res) => {
	let s_protocol = d_req.params[0];
	if(s_protocol) {
		let s_endpoint = d_req.params[1];
		if('http' === s_protocol) {
			d_res.redirect(301, `/browse/${s_endpoint}`);
		}
		else {
			d_res.status(400).end('SPARQL endpoint URL must use the HTTP protocol');
		}
	}
	else {
		d_res.render('explore');
	}
});

// seed new dataset
k_app.get('/seed', (d_req, d_res) => {
	d_res.render('seed');
});

// query dataset
k_app.get('/query', (d_req, d_res) => {
	d_res.render('query');
});

k_app.get('/debug', (d_req, d_res) => {
	d_res.render('debug');
});

// fetch specific pack
k_app.get([
	'/pack/:pack',
], (d_req, d_res) => {
	// extract pack
	let s_pack = d_req.params.pack;
	assert_safe_path(s_pack);

	d_res.sendFile(path.join(P_DIR_FETCH, 'packs', s_pack+'.json'));
});

// fetch specific pack
k_app.get([
	'/context/:context',
], (d_req, d_res) => {
	// extract context
	let s_context = d_req.params.context;
	assert_safe_path(s_context);
debugger;
	d_res.header('Access-Control-Allow-Origin', '*');
	d_res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
	d_res.sendFile(path.join(P_DIR_FETCH, 'contexts', s_context+'.json'), {
		headers: {
			'Content-Type': 'application/ld+json',
		},
	});
});


// fetch all configs
k_app.get([
	'/configs',
], (d_req, d_res) => {
	k_pool.query('select * from configs', (e_select, h_result) => {
		if(e_select) {
			return d_res.status(500).end('failed to fetch config due to a query error');
		}

		// build json response
		let h_configs = {};
		h_result.rows.forEach((h_row) => {
			h_configs[h_row.endpoint] = h_row.config;
		});

		// send json response
		d_res.json(h_configs).end();
	});
});

// how to use config
k_app.get('/config', (d_req, d_res) => {
	d_res.render('config');
});

// fetch specific config
k_app.get([
	/^\/config\/(.+)$/,
], (d_req, d_res) => {
	// extract source
	let s_source = resolve_endpoint(d_req.params[0], d_res);
	if(!s_source) return;

	// fetch config
	k_pool.query('select config from configs where endpoint=$1::text', [s_source], (e_query, h_result) => {
		if(e_query) {
			return d_res.status(500).end('failed to fetch config due to a query error '+e_query);
		}

		if(!h_result.rows.length) {
			return d_res.status(404).end('no config set for that endpoint');
		}

		// send json response
		d_res.json(h_result.rows[0].config).end();
	});
});

// set config
k_app.put([
	/^\/config\/(.+)$/,
], (d_req, d_res) => {
	// must be json
	if(!d_req.is('application/json')) {
		return d_res.status(415).end('config data must be JSON');
	}

	// must have json
	if(!d_req.body) {
		return d_res.status(400).end('JSON config must have data');
	}

	// extract source
	let s_source = resolve_endpoint(d_req.params[0], d_res);
	if(!s_source) return;

	let d_url;
	try {
		d_url = new url.URL('http://'+s_source);
	}
	catch(e_parse) {
		return d_res.status(400).end('invalid endpoint URL');
	}

	// ref client's IP and family
	let p_remote_addr = d_req.connection.remoteAddress;
	let s_remote_family = d_req.connection.remoteFamily;

	// prep to verify endpoint
	let verify_authority = (e_resolve, a_addresses) => {
		// authority failed
		if(!a_addresses.includes(p_remote_addr)) {
			return d_res.status(403).end(`This resource may only be updated by an HTTP request from a machine with an address listed in the DNS records for ${d_url.hostname}`);
		}

		// make sure it is a SPARQL endpoint
		request.post({
			url: 'http://'+s_source,
			headers: {
				accept: 'application/sparql-results+json',
			},
			form: {
				query: 'select * { ?s ?p ?o } limit 1',
			},
		}, (e_req_sparql, d_res_sparql, s_body_sparql) => {
			if(e_req_sparql) {
				return d_res.status(520).end(e_req_sparql);
			}

			if(200 !== d_res_sparql.statusCode) {
				return d_res.status(503).end(`http://${s_source} returned a non-200 response for a test SPARQL query (${d_res.statusCode})\n`+s_body_sparql);
			}

			// save config
			k_pool.query(`insert into endpoints (endpoint, config)
				values ($1::text, $2::json)
				on conflict do update set config = $2::json where endpoint = $1::text`,
				[
					s_source,
					JSON.stringify(d_req.body),
				], (e_query, h_result) => {
					if(e_query) {
						return d_res.status(500).end('failed to insert/update config due to a query error');
					}

					// failure
					if(!h_result.rowCount) {
						return d_res.status(500).end('failed to insert/update config');
					}

					// it worked
					d_res.end('good job!');
				});
		});
	};

	// it is an ipv4
	if('ipv4' === s_remote_family.toLowerCase()) {
		// resolve A record
		dns.resolve4(d_url.hostname, verify_authority);
	}
	// ipv6
	else if('ipv6' === s_remote_family.toLowerCase()) {
		// resolve A record
		dns.resolve6(d_url.hostname, verify_authority);
	}
	// other?!
	else {
		d_req.status(500).end('non ipv4/ipv6 address');
	}
});

// describe plugin
k_app.get([
	'/plugin/:plugin',
], (d_req, d_res) => {
	// fetch plugin name
	let s_plugin = d_req.params.plugin;

	// content negotiation
	d_req.negotiate({
		'text/html': () => {
			// use npm to install package locally
			check_npm_package(s_plugin, (e_check, s_semver) => {
				if(e_check) {
					d_res.status(500).end('failed to check for plugin');
				}
				else {
					d_res.end(`${s_plugin} is ${s_semver? 'already': 'not yet'} installed`);
				}
			});
		},

		// json
		'application/json': () => {
			fetch_package(s_plugin, d_res, (h_package) => {
				d_res.json(h_package.assets || {}).end();
			});
		},

		// javascript
		'text/javascript': () => {
			fetch_package(s_plugin, d_res, (h_package) => {
				// set main entry as asset
				let p_asset = h_package.main.replace(/^(\/*|(\.+\/)*)*/, '');

				// redirect
				d_res.redirect(303, `/plugin/${s_plugin}/${p_asset}`);
			});
		},
	});
});


class streamStringWrapper extends stream.Transform {
	constructor(s_head, s_tail) {
		super();

		// flag for marking first chunk
		this.began = false;

		// head and tail
		this.head = Buffer.from(s_head+' ');
		this.tail = Buffer.from(' '+s_tail);
	}

	_transform(ab_chunk, s_encoding, fk_chunk) {
		// just started
		if(!this.began) {
			// concat head + chunk
			fk_chunk(null, Buffer.concat([this.head, ab_chunk], this.head.length+ab_chunk.length));

			// set flag
			this.began = true;
		}
		// continuation
		else {
			fk_chunk(null, ab_chunk);
		}
	}

	_flush(fk_flush) {
		// push tail
		this.push(this.tail);

		// eof
		this.push(null);

		// done
		fk_flush();
	}
}

// describe plugin
k_app.get([
	/^\/plugin\/([\w0-9_\-]+)\/([^/].*)/,
], (d_req, d_res) => {
	// fetch plugin name
	let s_plugin = d_req.params[0];

	// fetch asset path
	let p_asset = d_req.params[1];

	// bad path
	if(p_asset.includes('..')) {
		d_req.status(400).end('asset may not contain two consecutive full stops ');
	}

	// // invalid asset
	// if(!H_PLUGIN_ASSET_TYPES[s_asset]) {
	// 	d_res.status(404).end(`No such asset type: ${s_asset}`);
	// }

	// use npm to install package locally
	install_npm_package(s_plugin, (e_install, s_data) => {
		// install error
		if(e_install) {
			d_res.status(400).end('failed to install plugin '+e_install);
		}
		// package is ready
		else {
			// set its directory
			let p_dir_plugin = path.join(P_DIR_PLUGINS, 'node_modules', s_plugin);

			// full path to asset file
			let p_asset_file = path.join(p_dir_plugin, p_asset);

			// asset is a js file
			if(p_asset.endsWith('.js')) {
				// path for cached bundled version
				let p_bundle_cached = path.join(P_DIR_PLUGINS, 'cache', s_plugin+'.js');

				// try reading
				fs.open(p_bundle_cached, 'r', (e_open, df_cached) => {
					// i/o error, file not exists?
					if(e_open) {
						// new bundle
						let k_bundle = browserify({
							standalone: 'phuzzy-xsd',
						});

						try {
							// add asset
							k_bundle.add(p_asset_file);

							// bundle
							let ds_bundle = k_bundle.bundle()
								// add head and tail
								.pipe(new streamStringWrapper('var module = {exports: {}};', 'module;'));

							// save to file
							ds_bundle.pipe(fs.createWriteStream(p_bundle_cached));

							// pipe to response
							ds_bundle.pipe(d_res);
						}
						catch(e_bundle) {
							// invalid module path
							if(e_bundle.message.startsWith('Cannot find module')) {
								d_res.status(400).end(`npm package does not contain a module "${p_asset}"`);
							}
							// failed to bundle
							else {
								d_res.status(500).end('failed to bundle:: '+e_bundle);
							}
						}
					}
					// i/o okay
					else {
						// create read stream and pipe to response
						fs.createReadStream(p_bundle_cached, {
							fd: df_cached,
						}).pipe(d_res);
					}
				});
			}
			// asset is something else
			else {
				d_res.sendFile(p_asset_file);
			}

			// // read its package
			// let h_plugin_package = require(p_dir_plugin+'/package.json');
		}
	});
});


// before server starts
async.parallel([
	(fk_task) => {
		// handle i/o now
		mkdirp(path.join(P_DIR_PLUGINS, 'cache'), (e_mkdirp) => {
			// i/o error
			if(e_mkdirp) {
				return fk_task(e_mkdirp);
			}

			fk_task(null);
		});
	},
], (e_tasks) => {
	// startup errors
	if(e_tasks) {
		throw e_tasks;
	}

	// bind to port
	k_app.listen(N_PORT, () => {
		console.log('running on port '+N_PORT);
	});
});
