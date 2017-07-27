
const stream = require('stream');
const url = require('url');

const $ = require('jquery-browserify');
const graphy = require('graphy');
const request = require('request');
const async = require('async');

const ace = require('brace');
require('../ace/mode-turtle.js');
require('brace/theme/chrome');
require('brace/mode/xml');
require('brace/mode/json');


const H_INTERNAL_PREFIXES = {
	rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
	rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
	xsd: 'http://www.w3.org/2001/XMLSchema#',
	geosparql: 'http://www.opengis.net/ont/geosparql#',
	ago: 'http://awesemantic-geo.link/ontology/',
	usgs: 'http://cegis.usgs.gov/Ontology/',
	owl: 'http://www.w3.org/2002/07/owl#',
};


function tts(h_prefixes) {
	return (s_tts) => {
		let [, s_prefix, s_suffix] = R_TTS_IRI.exec(s_tts);
		return h_prefixes[s_prefix]+s_suffix;
	};
}

const n3i = tts(H_INTERNAL_PREFIXES);

const P_IRI_RDFS_LABEL = H_INTERNAL_PREFIXES.rdfs+'label';
const S_MIME_SPARQL_RESULTS = 'application/sparql-results+json';
const S_MIME_FORM = 'application/x-www-form-urlencoded';
const S_MIME_TEXT = 'text/plain;charset=UTF-8';


function dd(...a_args) {
	let d_element;
	let z_arg = a_args.shift();
	if(!z_arg) return;
	if('string' === typeof z_arg) {
		d_element = document.createElement(z_arg);
		z_arg = a_args.shift();
		if(!z_arg) return d_element;
	}
	else {
		d_element = document.createElement('div');
	}

	// properties
	if(Object === z_arg.constructor) {
		Object.assign(d_element, z_arg);
		z_arg = a_args.shift();
		if(!z_arg) return d_element;
	}

	// attributes
	if(Object === z_arg.constructor) {
		for(let s_key in z_arg) {
			d_element.setAttribute(s_key, z_arg[s_key]);
		}
		z_arg = a_args.shift();
		if(!z_arg) return d_element;
	}

	// child nodes
	if(Array.isArray(z_arg)) {
		z_arg.forEach((d_child) => {
			if(d_child) {
				d_element.appendChild(d_child);
			}
		});
	}

	return d_element;
}

function dereference(p_uri, pm_format, fk_resource) {
	// make xhr
	let d_xhr = new XMLHttpRequest();
	if(!d_xhr) {
		throw 'cannot instantiate XMLHttpRequest';
	}

	// capture ready state change events
	d_xhr.onreadystatechange = () => {
		// ready state
		switch(d_xhr.readyState) {
			case XMLHttpRequest.DONE: {
				// HTTP response is okay
				if(200 === d_xhr.status) {
					// bad content type
					let s_content_type = d_xhr.getResponseHeader('Content-Type');
					if(!s_content_type.startsWith(pm_format)) {
						throw `bad content type: '${s_content_type}'`;
					}

					// forward to callback
					fk_resource(null, d_xhr.responseText, d_xhr);
				}
				// HTTP response not okay
				else {
					// fail
					if(d_xhr.status) {
						fk_resource(d_xhr.status, d_xhr.responseText, d_xhr);
					}
					// 0
					else {
						console.warn('HTTP response code: 0 ?!');
					}
				}
				break;
			}
		}
	};

	// open async http post request to endpoint
	d_xhr.open('GET', p_uri, true);

	// headers
	d_xhr.setRequestHeader('Accept', pm_format);
	d_xhr.setRequestHeader('Cache-Control', 'no-cache, max-age=0');

	// send
	d_xhr.send();

	console.warn('open xhr not closeable');
}


const F_SORT_PREDICATES = (a, b) => {
	let s_a=a.predicate, s_b=b.predicate;

	return b - a;

	// let i_a = A_PREDICATE_DISPLAY_ORDER.indexOf(s_a);
	// let i_b = A_PREDICATE_DISPLAY_ORDER.indexOf(s_b);

	// // a not prioritized
	// if(i_a < 0) {
	// 	// neither predicates are prioritized; sort alphabetically
	// 	if(i_b < 0) return a < b? -1: 1;
	// 	// b is prioritized
	// 	else return 1;
	// }
	// // b not prioritized; a is prioritized
	// else if(i_b < 0) {
	// 	return -1;
	// }

	// // a and b are both prioritized, sort by highest priority
	// return i_a - i_b;
};


class ResourceChannel {
	constructor(h_config) {
		let {
			key: s_key,
			channel: s_channel,
			table: d_table,
			phuzzy: k_phuzzy,
			loader: k_loader,
		} = h_config;

		Object.assign(this, {
			key: s_key,
			channel: s_channel,
			loader: k_loader,
			phuzzy: k_phuzzy,
			elements: {
				table: d_table,
			},
			triples: {},
			finished: false,
			existing_rows: {},
			prefixes_used: new Set(),
			complete_pairs: new Set(),
			open_xhrs: new Set(),
			result_sets_complete: new Set(),
			result_sets_complete_mono: new Set(),
			stats: {
				triples: 0,
			},
		});
	}

	// forward to callback handler
	update_status(s_text) {
		this.phuzzy.status[this.channel](s_text);
	}

	// abort all open xhrs
	abort() {
		// each item
		this.open_xhrs.forEach((d_xhr) => {
			// abort xhr
			d_xhr.abort();
		});

		// clear all items from set at once
		this.open_xhrs.clear();
	}

	completeness(i_start_set, n_direction) {
		let {
			result_sets_complete: as_complete,
			result_sets_complete_mono: as_mono,
		} = this;

		// iterate
		for(let i_set=i_start_set; ; i_set+=n_direction) {
			// hit first set
			if(!i_set) {
				// as long as it is complete we're good
				return as_complete.has(0);
			}

			// set is complete
			if(as_complete.has(i_set)) {
				// but it is full of same predicate
				if(as_mono.has(i_set)) {
					// keep trying
					continue;
				}
				// not mono!
				else {
					return true;
				}
			}
			// set is incomplete
			else {
				return false;
			}
		}
	}


	predicate_index(p_predicate) {
		let k_phuzzy = this.phuzzy;
		let s_terse = k_phuzzy.terse(p_predicate);

		let ar_rules = k_phuzzy.sort_order;

		// each rule
		for(let i_rule=0; i_rule<ar_rules.length; i_rule++) {
			let r_rule = ar_rules[i_rule];

			// terminal wildcard
			if(r_rule.test(s_terse)) {
				return i_rule;
			}
		}

		// no match; rank at end
		return ar_rules.length;
	}


	download_triples(s_query, n_chunk_size, fk_download) {
		// update status
		this.update_status('Querying endpoint...');

		// outgoing properties
		this.query_triples(this.phuzzy.sparql_query_header+s_query, n_chunk_size, () => {
			this.finished = true;
			this.update_status(this.stats.triples+' triples');
			fk_download();
		});
	}


	query_triples(s_query, n_chunk_size, fk_triples) {
		// download using limit/offset
		this.download_query_results(s_query, n_chunk_size, 0, this.loader.sparql_mime, (a_bindings) => {
			// results size
			let n_results = a_bindings.length;

			// no results
			if(!n_results) {
				// abort pre-emptive 2nd request
				this.abort();

				// only if this wasn't already finished
				if(!this.finished) {
					// no more requests
					fk_triples();
				}
			}
			// yes results
			else {
				// assume not terminal
				let b_terminal = false;

				// results under chunk size
				if(n_chunk_size !== n_results) {
					// abort pre-emptive 2nd request
					this.abort();

					// it is terminal
					b_terminal = true;
				}

				// process results
				this.process_results(a_bindings, 0, b_terminal);

				// this was last result set
				if(b_terminal) {
					// only if this wasn't already finished
					if(!this.finished) {
						// no more requests
						fk_triples();
					}
				}
			}
		});

		// pre-emptively download 2nd offset
		let c_offset = n_chunk_size;

		// callback handler for chunked download
		let f_chunked_download = (a_bindings) => {
			// results size
			let n_results = a_bindings.length;

			// no results
			if(!n_results) {
				// only if this wasn't already finished
				if(!this.finished) {
					// no more requests :)
					fk_triples();
				}
			}
			// yes results
			else {
				// assume not terminal
				let b_terminal = false;

				// results met chunk size
				if(n_chunk_size === n_results) {
					// queue next download
					c_offset += n_chunk_size;
					this.download_query_results(s_query, n_chunk_size, c_offset, this.loader.sparql_mime, f_chunked_download);
				}
				// results under chunk size
				else {
					// it is terminal
					b_terminal = true;
				}

				// process results
				this.process_results(a_bindings, c_offset/n_chunk_size, b_terminal);

				// this was last result set
				if(b_terminal) {
					// only if this wasn't already finished
					if(!this.finished) {
						// no more requests
						fk_triples();
					}
				}
			}
		};

		// begin chunked download
		this.download_query_results(s_query, n_chunk_size, c_offset, this.loader.sparql_mime, f_chunked_download);
	}

	// 
	download_query_results(s_query, n_limit, n_offset, s_mime, fk_results) {
		// mutate query string
		s_query += ` limit ${n_limit} offset ${n_offset}`;

		// make xhr
		let d_xhr = new XMLHttpRequest();
		if(!d_xhr) {
			throw 'cannot instantiate XMLHttpRequest';
		}

		// capture ready state change events
		d_xhr.onreadystatechange = () => {
			// ready state
			switch(d_xhr.readyState) {
				case XMLHttpRequest.DONE: {
					// remove from list of open xhrs
					this.open_xhrs.delete(d_xhr);

					// HTTP response is okay
					if(200 === d_xhr.status) {
						// bad content type
						let s_content_type = d_xhr.getResponseHeader('Content-Type');
						if(!s_content_type.startsWith(S_MIME_SPARQL_RESULTS)) {
							throw `bad content type: '${s_content_type}'`;
						}

						// parse json
						let h_json;
						try {
							h_json = JSON.parse(d_xhr.responseText);
						}
						catch(e_parse) {
							throw 'bad JSON response from server';
						}

						// extract bindings from results
						let a_bindings = h_json.results.bindings;

						// forward to callback
						fk_results(a_bindings);
					}
					// HTTP response not okay
					else {
						// client error
						if(d_xhr.status >= 400 && d_xhr.status < 500) {
							// haven't tried alternative yet
							if(S_MIME_FORM === this.query_mime) {
								// change mime for future requests
								this.loader.sparql_mime = S_MIME_TEXT;

								// retry with alternative method
								this.download_query_results(s_query, n_limit, n_offset, S_MIME_TEXT, fk_results);
							}
							// already tried
							else {
								throw 'fail';
							}
						}
						// fail
						else if(d_xhr.status) {
							throw 'fail';
						}
						// 0
						else {
							console.warn('HTTP response code: 0 ?!');
						}
					}
					break;
				}
			}
		};

		// open async http post request to endpoint
		d_xhr.open('POST', this.phuzzy.endpoint, true);

		// headers
		d_xhr.setRequestHeader('Accept', S_MIME_SPARQL_RESULTS);

		// mime
		d_xhr.setRequestHeader('Content-Type', s_mime);

		// form
		if(S_MIME_FORM === s_mime) {
			// submit sparql query in post body
			d_xhr.send('query='+encodeURIComponent(s_query));
		}
		// plain
		else if(S_MIME_TEXT === s_mime) {
			// plain text in post bosy
			d_xhr.send(s_query);
		}

		// add to list of open xhrs
		this.open_xhrs.add(d_xhr);
	}


	add_triple(p_predicate, h_term, i_insertion=-1) {
		// ref existing object
		let h_existing_row = this.existing_rows[p_predicate];

		// ref value list element
		let d_value_list = h_existing_row.value_list;

		// render value
		let d_cell = this.render_value(h_term);

		// list of values elements
		let a_children = d_value_list.childNodes;

		// ref value
		let s_value = h_term.value;

		// no insertion index
		if(i_insertion < 0) {
			// find where to insert value
			for(let i_child=0, n_children=a_children.length; i_child<n_children; i_child++) {
				// fetch test value
				let s_test = a_children[i_child].getAttribute('data-value');

				// found position
				if(s_test > s_value) {
					// insert here
					d_value_list.insertBefore(d_cell, a_children[i_child]);

					// all done
					return i_child + 1;
				}
			}

			// append to end
			d_value_list.appendChild(d_cell);

			// new index
			return a_children.length;
		}
		// insertion index given
		else {
			// position is at the very end
			if(a_children.length === i_insertion) {
				// append child
				d_value_list.appendChild(d_cell);
			}
			// somewhere before the end
			else {
				// insert at the position
				d_value_list.insertBefore(d_cell, a_children[i_insertion]);
			}
		}

		// advance the index
		return i_insertion + 1;
	}

	render_value(h_term) {
		let k_phuzzy = this.phuzzy;

		// deconstruct local fields
		let {
			named_node: af_named_node,
			blank_node: af_blank_node,
			literal: af_literal,
			datatypes: hf_datatypes,
		} = k_phuzzy;

		// value cell
		let d_cell = document.createElement('span');
		d_cell.classList.add('value');
		d_cell.setAttribute('data-value', h_term.value);

		// callback list
		let af_callback;

		// value is a named node
		if('uri' === h_term.type) {
			let p_term = h_term.value;
			k_phuzzy.linkify(p_term, d_cell, h_term.label);

			// set callback handler
			af_callback = af_named_node;
		}
		// value is a blank node
		else if('bnode' === h_term.type) {
			// add class
			d_cell.classList.add('blank-node');

			// set callback handler
			af_callback = af_blank_node;
		}
		// value is a typed literal
		else if('literal' === h_term.type || 'typed-literal' === h_term.type) {
			// add class
			d_cell.classList.add('literal');

			// add content
			let d_content = document.createElement('span');
			d_content.classList.add('content');
			d_content.textContent = h_term.value;

			// literal has language tag
			if('xml:lang' in h_term) {
				let s_language = h_term['xml:lang'];
				d_cell.setAttribute('data-language', s_language);

				// append content to cell
				d_cell.appendChild(d_content);

				// add language tag
				let d_language = document.createElement('span');
				d_language.classList.add('language');
				d_language.textContent = s_language;
				d_cell.appendChild(d_language);
			}
			// no language
			else {
				// datatype exists
				if('datatype' in h_term) {
					// fetch datatype
					let p_datatype = h_term.datatype || '';

					// mapping exists for datatype
					if(hf_datatypes[p_datatype]) {
						let h_literal_mapping = hf_datatypes[p_datatype];

						// apply the function on the given term and cell
						let s_class = h_literal_mapping.load(h_term, d_cell);

						// function returned class to add
						if('string' === typeof s_class) {
							d_cell.classList.add(s_class);
							d_cell.appendChild(d_content);
						}
					}
					// no mapping exists
					else {
						d_cell.appendChild(d_content);

						this.loader.missing_datatype(p_datatype);
					}

					// append datatype
					if(p_datatype) {
						let s_tt_datatype = k_phuzzy.terse(p_datatype);
						let d_datatype = document.createElement('span');
						d_datatype.classList.add('datatype');
						d_datatype.textContent = s_tt_datatype;
						d_cell.appendChild(d_datatype);
					}
				}
				// no datatype
				else {
					d_cell.appendChild(d_content);
				}
			}

			// set callback handler
			af_callback = af_literal;
		}
		else {
			throw `sparql-results included unknown term type: ${h_term.type}`;
		}

		// each callback for this term type
		af_callback.forEach((f_term) => {
			f_term(h_term, d_cell, k_phuzzy);
		});

		// return element
		return d_cell;
	}


	insert_row(p_predicate, d_row) {
		let d_table = this.elements.table;

		// row elements
		let ad_rows = d_table.childNodes;

		// how many rows there are
		let n_rows = ad_rows.length;

		// no rows yet
		if(!n_rows) {
			// insert row at beginning
			d_table.appendChild(d_row);
		}
		// there are rows
		else {
			// start with this predicate index
			let i_index = this.predicate_index(p_predicate);

			// each row already on page
			for(let i_row=0; i_row<n_rows; i_row++) {
				// compare to other node
				let d_compare = ad_rows[i_row];

				// not a row node
				if(!d_compare.classList.contains('row')) continue;

				// its predicate
				let p_compare_predicate = d_compare.getAttribute('data-predicate');

				// its rank
				let i_compare_rank = this.predicate_index(p_compare_predicate);

				// this element belongs before the current node!
				if(i_index < i_compare_rank) {
					// insert element
					d_table.insertBefore(d_row, d_compare);

					// stop searching for insertion point
					return;
				}
				// ranks tied
				else if(i_index === i_compare_rank) {
					// this one beats the other alphabetically
					if(p_predicate < p_compare_predicate) {
						d_table.insertBefore(d_row, d_compare);
					}
					// the other one wins
					else {
						// continue scanning for appropriate spot
						continue;
					}
				}
			}

			// was not inserted before any children, append to end
			d_table.appendChild(d_row);
		}
	}

	sparql_result_tt(h_row) {
		switch(h_row.type) {
			case 'uri': return this.phuzzy.terse(h_row.value);
			case 'bnode': return '_:'+h_row.value;
			case 'typed-literal': return '^'+this.phuzzy.terse(h_row.datatype)+'"'+h_row.value;
			case 'literal': {
				if('xml:lang' in h_row) return '@'+h_row['xml:lang']+'"'+h_row.value;
				return '"'+h_row.value;
			}
			default: {
				throw 'unexpected sparql result type '+h_row;
			}
		}
	}


	process_results(a_bindings, i_set, b_terminal) {
		// update status
		if(a_bindings.length) {
			this.stats.triples += a_bindings.length;
			this.update_status('Loaded '+this.stats.triples+' triples...');
		}

		// ref phuzzy instance
		let k_phuzzy = this.phuzzy;


		// triples hash for serialization
		let h_triples = this.triples;

		// value key is opposite of mode
		let s_value_key = this.key;


		// ref pairs hash
		let h_existing_rows = this.existing_rows;

		// pairs that arrived this round
		let h_new_pairs = {};


		// primary predicate
		let p_primary_predicate = a_bindings[0].predicate.value;

		// terminal predicate
		let p_terminal_predicate = a_bindings[a_bindings.length-1].predicate.value;

		let as_prefixes_used = this.prefixes_used;

		// help speed up insertion by keeping an index tracker
		let i_insert_value = -1;
		let p_previous_predicate = '';

		// each binding result row
		a_bindings.forEach((h_row) => {
			// ref predicate iri
			let p_predicate = h_row.predicate.value;

			// ref value from entry
			let h_value = h_row[s_value_key];

			// tersify predicate and value
			let s_predicate_terse = k_phuzzy.terse(p_predicate);
			let s_value_tt = this.sparql_result_tt(h_value);

			// add prefixes used to set
			if('<' !== s_predicate_terse[0]) {
				as_prefixes_used.add(s_predicate_terse.substring(0, s_predicate_terse.indexOf(':')));
			}
			// named node
			if('uri' === h_value.type) {
				if('<' !== s_value_tt[0]) {
					as_prefixes_used.add(s_value_tt.substring(0, s_value_tt.indexOf(':')));
				}
			}
			// literal
			else if('bnode' !== h_value.type) {
				if('^' === s_value_tt[0] && '<' !== s_value_tt[1]) {
					as_prefixes_used.add(s_value_tt.substring(1, s_value_tt.indexOf(':')));
				}
			}

			// different than previous iteration
			if(p_predicate !== p_previous_predicate) {
				// reset insertion index
				i_insert_value = -1;

				// first encounter of predicate this round
				if(!h_new_pairs[p_predicate]) {
					// now predicate has been encountered
					let a_values = h_new_pairs[p_predicate] = [h_value];

					// predicate has been encountered in a separate loading
					if(p_predicate in h_existing_rows) {
						// insert new value wherever it belongs
						i_insert_value = this.add_triple(p_predicate, h_value, i_insert_value);

						// append to triples hash
						h_triples[s_predicate_terse].push(s_value_tt);
					}
					// first encounter ever
					else {
						// mk predicate cell
						let d_cell_predicate = document.createElement('span');
						d_cell_predicate.classList.add('predicate');
						d_cell_predicate.setAttribute('data-predicate', p_predicate);

						// mk values cell
						let d_values_cell = document.createElement('div');
						d_values_cell.classList.add('values-cell');

						// mk value list
						let d_values_list = document.createElement('div');
						d_values_list.classList.add('values-list');
						d_values_cell.appendChild(d_values_list);

						// mk whole row
						let d_row = document.createElement('div');
						d_row.classList.add('row');
						if('subject' === this.key) {
							d_row.classList.add('inverse');
						}
						d_row.setAttribute('data-predicate', p_predicate);
						d_row.appendChild(d_cell_predicate);
						d_row.appendChild(d_values_cell);

						// insert row into right place
						this.insert_row(p_predicate, d_row);

						// linkify predicate
						let s_terse = k_phuzzy.linkify(p_predicate, d_cell_predicate);

						// predicate has long name
						if(s_terse.length > 17) {
							d_cell_predicate.classList.add('long-name');
						}

						// inverse mode
						if('incoming' === this.key) {
							d_cell_predicate.classList.add('inverse');
							d_values_cell.classList.add('inverse');
						}

						// make object
						h_existing_rows[p_predicate] = {
							row: d_row,
							predicate_cell: d_cell_predicate,
							value_list: d_values_list,
							values: a_values,
						};

						// insert new value at beginning
						i_insert_value = this.add_triple(p_predicate, h_value, 0);

						// append to triples hash
						h_triples[s_predicate_terse] = [s_value_tt];
					}
				}
			}
			// same predicate as previous iteration
			else {
				// insert new value where it belongs
				i_insert_value = this.add_triple(p_predicate, h_value, i_insert_value);

				// push to list
				h_new_pairs[p_predicate].push(h_value);

				// append to triples hash
				h_triples[s_predicate_terse].push(s_value_tt);
			}

			// update previous predicate
			p_previous_predicate = p_predicate;
		});


		// primary and terminal are different
		if(p_primary_predicate !== p_terminal_predicate) {
			// primary predicate complete if:
			let b_primary_complete = 0 === i_set  // this is first result set
				|| this.completeness(i_set, -1);  // previous result set(s) complete

			// terminal predicate complete if:
			let b_terminal_complete = b_terminal  // this is the last result set
				|| this.completeness(i_set, +1);  // next result set(s) complete

			// move all completed pairs over from partial set
			for(let p_predicate in h_new_pairs) {
				// whether or not the given pair is complete
				let b_complete = false;

				// primary predicate
				if(p_primary_predicate === p_predicate) {
					// it is complete
					if(b_primary_complete) {
						b_complete = true;
					}
				}
				// terminal prediate
				else if(p_terminal_predicate === p_predicate) {
					// it is complete
					if(b_terminal_complete) {
						b_complete = true;
					}
				}
				// neither primary nor terminal
				else {
					// it is contained
					b_complete = true;
				}

				// pair is complete
				if(b_complete) {
					// complete row
					this.complete_row(p_predicate);
				}
			}
		}
		// primary and terminal are same
		else {
			// however, (first result set or previous result set is complete) and this is the last set
			if(b_terminal && (!i_set || this.completeness(i_set, -1))) {
				this.complete_row(p_primary_predicate);
			}
		}
	}

	// process finishing callbacks for row
	complete_row(p_predicate) {
		// deconstruct local fields
		let {
			complete_pairs: as_complete_pairs,
			phuzzy: k_phuzzy,
		} = this;

		// but it already was complete?
		if(as_complete_pairs.has(p_predicate)) {
			debugger;
		}
		else {
			// deconstruct phuzzy fields
			let {
				row: af_row,
				predicates: hf_predicates,
			} = k_phuzzy;

			// move over to completed set
			as_complete_pairs.add(p_predicate);

			// trigger
			console.info('completed '+p_predicate);

			// fetch row decriptor
			let h_row = this.existing_rows[p_predicate];

			// special handler for this predicate
			if(p_predicate in hf_predicates) {
				// apply handler
				hf_predicates[p_predicate].load(h_row.values, h_row.row);
			}

			// each row handler
			af_row.forEach((f_row) => {
				// apply handler
				f_row(p_predicate, h_row.values, h_row.row);
			});

			// // add to hash
			// k_phuzzy.writer_outgoing.add({
			// 	[this.loader.resource_terse]: {
			// 		[k_phuzzy.terse(p_predicate)]: this.triples[p_predicate],
			// 	},
			// });
		}
	}
}


class ResourceLoader {
	constructor(p_resource, k_phuzzy, fk_resource) {
		// abstract
		let d_abstract = document.getElementById('abstract');
		k_phuzzy.abstract.forEach((f_abstract) => {
			f_abstract(d_abstract);
		});

		let k_outgoing = this.outgoing = new ResourceChannel({
			key: 'object',
			channel: 'outgoing',
			table: k_phuzzy.space.querySelector('.outgoing>.body>.table'),
			phuzzy: k_phuzzy,
			loader: this,
		});

		let k_incoming = this.incoming = new ResourceChannel({
			key: 'subject',
			channel: 'incoming',
			table: k_phuzzy.space.querySelector('.incoming>.body>.table'),
			phuzzy: k_phuzzy,
			loader: this,
		});

		Object.assign(this, {
			resource: p_resource,
			resource_terse: k_phuzzy.terse(p_resource),
			phuzzy: k_phuzzy,
			outgoing_ttl: '',
			missing_datatypes: {},
			sparql_mime: S_MIME_FORM,  // default query mime type
		});

		// set label
		k_phuzzy.space.querySelector('.outgoing>.header>.text').textContent = k_phuzzy.terse(p_resource);

		// set rdf display
		k_phuzzy.space.querySelector('.outgoing>.header>.source').classList.add('loading');

		// fetch chunk size
		let n_chunk_size = k_phuzzy.chunk_size;

		// at same time
		async.parallel([
			(fk_task) => {
				k_outgoing.download_triples(`
					select distinct ?predicate ?object {
						<${p_resource}> ?predicate ?object .
					} order by ?predicate ?object
				`, n_chunk_size, () => {
					fk_task();
				});
			},

			(fk_task) => {
				k_incoming.download_triples(`
					select distinct ?subject ?predicate {
						?subject ?predicate <${p_resource}> .
					} order by ?predicate ?subject
				`, n_chunk_size, () => {
					fk_task();
				});
			},
		], () => {
			fk_resource();
		});
	}

	// abort all open xhrs
	abort() {
		this.incoming.abort();
		this.outgoing.abort();
	}

	clear() {
		this.abort();
		$(this.phuzzy.space).find('.row').remove();
	}

	missing_datatype(p_datatype) {
		// first encounter of missing this datatype
		if(!(p_datatype in this.missing_datatypes)) {
			// update hash
			this.missing_datatypes[p_datatype] = 1;

			// issue warning
			console.warn(`no datatype mapping for ${p_datatype}`);
		}
	}
}

class Machine {
	constructor(d_machine, k_phuzzy) {
		let k_machine = this;

		let d_formats = document.getElementById('rdf-format');
		let d_display = document.getElementById('rdf-display');
		let d_editor = document.getElementById('rdf-editor');

		this.phuzzy = k_phuzzy;
		this.element = {
			container: d_machine,
			formats: d_formats,
			display: d_display,
			editor: d_editor,
		};

		// initialize ace
		{
			let y_editor = this.editor = ace.edit(d_editor);
			y_editor.setTheme('ace/theme/chrome');
			y_editor.setFontSize(10);
			y_editor.renderer.$fontMetrics.setPolling(false);
			y_editor.$blockScrolling = Infinity;

			let y_session = y_editor.getSession();
			y_session.setMode('ace/mode/turtle');
			y_session.setUseWrapMode(true);
			y_session.setTabSize(3);
		}

		// initialize format buttons
		{
			// graphy generate from SELECT results
			d_formats.querySelectorAll('.graphy>.formats>.format').forEach((d_format) => {
				d_format.addEventListener('click', function() {
					// select format
					let pm_format = k_machine.select_format(this);

					// serialize it!
					k_phuzzy.serialize(pm_format);
				}, true);
			});

			// dereference
			let f_dereference_format = function() {
				// select format
				let pm_format = k_machine.select_format(this);

				// attempt to dereference resource
				dereference(k_phuzzy.loader.resource, pm_format, (e_deref, s_body, d_xhr) => {
					// error
					if(e_deref) {
						console.log('error with '+pm_format+' <> '+this.getAttribute('data-mime-format'));
						k_machine.error(this, e_deref, s_body, d_xhr);
					}
					else {
						k_machine.edit_rdf(s_body, pm_format);
					}
				});
			};

			// bind to existing buttons
			d_formats.querySelectorAll('.dereference>.formats>.format').forEach((d_format) => {
				d_format.addEventListener('click', f_dereference_format);
			});

			//
			let f_append_format = function(d_input) {
				// fetch format
				let pm_format = d_input.value;

				// no format
				if(!pm_format) {
					d_input.focus();
					return;
				}

				// mk element
				let d_format = dd({
					className: 'format',
					textContent: pm_format,
				}, {'data-mime-format':pm_format});

				// bind click
				d_format.addEventListener('click', f_dereference_format);

				// insert into dom tree
				d_formats.querySelector('.dereference>.formats').insertBefore(d_format, d_input.parentNode);

				// dereference new format
				f_dereference_format.apply(d_format);

				// reset input
				d_input.value = '';
			};

			// bind to button click
			d_formats.querySelector('.dereference>.formats>.append>.add').addEventListener('click', function() {
				// append format
				f_append_format(this.parentNode.getElementsByTagName('input')[0]);
			});

			// bind to enter
			d_formats.querySelector('.dereference>.formats>.append>input').addEventListener('keypress', function(de) {
				// enter key
				if(13 === de.which) {
					f_append_format(this);
				}
			});
		}
	}

	toggle() {
		this.phuzzy.space.querySelector('.outgoing>.header>.source').classList.toggle('shown');
		this.element.container.classList.toggle('hide');
	}

	reset(p_uri) {
		this.phuzzy.space.querySelector('.outgoing>.header>.source').classList.remove('shown');
		this.element.container.classList.add('hide');
		let s_from = '';
		let d_url;
		try {
			d_url = url.parse(p_uri);
			if(d_url) s_from = ' from: '+d_url.hostname;
		}
		catch(e_parse) {}

		// clear error
		[].forEach.call(this.element.formats.getElementsByClassName('format error'), (d_error) => {
			d_error.classList.remove('error');
		});

		this.element.formats.querySelector('.dereference>.title').textContent = 'Dereference URI'+s_from;
	}

	select_format(d_format) {
		//  disable display
		this.disable_timer = setTimeout(() => {
			this.disable_display();
		}, 10);

		// unselect previously selected format(s)
		[].forEach.call(this.element.formats.getElementsByClassName('selected format'), d_e => d_e.classList.remove('selected'));

		// select new format
		d_format.classList.add('selected');

		// data format attribute
		return d_format.getAttribute('data-mime-format');
	}

	disable_display() {
		// lock display
		this.element.display.classList.remove('enabled');
		let y_editor = this.editor;
		y_editor.setReadOnly(true);
	}

	enable_display() {
		this.element.display.classList.remove('broken');
		clearTimeout(this.disable_timer);
		setTimeout(() => {
			this.element.display.classList.add('enabled');
			this.editor.setReadOnly(false);
		}, 0);
	}

	// load givne RDF code and set syntax using MIME type
	edit_rdf(s_code, pm_format) {
		this.enable_display();

		let y_editor = this.editor;
		let y_session = y_editor.getSession();
		switch(pm_format) {
			case 'text/n3':
			case 'text/rdf+n3':
			case 'application/trig':
			case 'application/n-triples':
			case 'application/n-quads':
			case 'text/turtle': y_session.setMode('ace/mode/turtle');
				break;
			case 'application/atom+xml':
			case 'application/rdf+xml': y_session.setMode('ace/mode/xml');
				break;
			case 'application/rdf+json':
			case 'application/odata+json':
			case 'application/ld+json': y_session.setMode('ace/mode/json');
				break;
			default: {
				if(pm_format.endsWith('+xml')) y_session.setMode('ace/mode/xml');
				if(pm_format.endsWith('+json')) y_session.setMode('ace/mode/json');
				else {
					console.warn('unable to determine syntax highlighting for mime type '+pm_format);
				}
			}
		}

		// unlock display
		this.enable_display();

		// update code
		y_editor.setValue(s_code);
		y_editor.clearSelection();
	}

	error(d_format, e_deref, s_body, d_xhr) {
		d_format.classList.add('error');

		// unlock display
		this.enable_display();

		let d_display = this.element.display;
		d_display.classList.add('broken');
		let d_page = d_display.querySelector('.page');
		$(d_page).empty();

		let s_message = '';
		switch(e_deref) {
			case 404: s_message = 'Server says resource does not exist'; break;
			case 406: s_message = 'Server cannot provide resource as this media type'; break;
			default: {
				if(e_deref >= 400 && e_deref < 500) {
					s_message = 'Server is blaming YOU for some reason!';
				}
				else if(e_deref >= 500 && e_deref < 600) {
					s_message = 'Server is taking responsibility for fucking this one up';
				}
				else {
					s_message = 'Not sure what the hell is going on here';
				}
			}
		}

		// error message and iframe to render html
		[
			dd({
				className: 'message',
			}, [
				dd('b', {textContent:e_deref+''}),
				dd('span', {textContent:': '+s_message}),
			]),
			dd('iframe', {
				// src: 'data:'+d_xhr.getResponseHeader('Content-Type')+','+encodeURI(s_body),
				srcdoc: s_body,
				onload() {
					let d_document = this.contentWindow.document;
					let d_style = d_document.createElement('style');
					d_document.body.appendChild(Object.assign(d_style, {
						innerHTML: `
							body {
								font-family: monospace;
								font-size: 0.7em;
							}
						`,
					}));
				},
			}),
		].forEach(d => d_page.appendChild(d));
	}
}


class Phuzzy {

	constructor(h_config) {
		Object.assign(this, {
			chunk_size: 1 << 7,
		}, h_config, {
			loader: null,
		});

		// dom elements
		let d_space = this.space = document.getElementById('triples');

		// machine
		this.machine = new Machine(document.getElementById('machine'), this);

		// rdf code display
		{
			this.serializer = null;
		}


		// set sparql query header
		this.sparql_query_header = '## query generated by http://phuzzy.link/ ##\n\n';

		// prefix map given
		if(this.prefiexs) {
			let h_prefixes = this.prefixes;

			// build string
			let s_header = '';
			for(let s_prefix in h_prefixes) {
				s_header += `prefix ${s_prefix}: <${h_prefixes[s_prefix]}>\n`;
			}

			// set field
			this.sparql_query_header = s_header;
		}

		// definitions for datatypes
		let h_datatypes = this.datatypes = {
			'': {
				owner: 'phuzzy.link',
				load(h_literal, d_cell) {
					return 'raw';
				},
			},
		};

		// default language
		let s_language = this.settings.language || 'en';

		// definitions for predicates
		let hf_predicates = this.predicates = {
			[n3i('rdfs:label')]: {
				owner: 'phuzzy.link',
				load: (a_labels) => {
					// prep best label to use
					let h_best_label = a_labels[0];

					// attempt to find a label in preferred language
					a_labels.some((h_label) => {
						// no language tag
						if(!h_label['xml:lang']) h_best_label = h_label;

						// found one that matches preferred language
						if(s_language === h_label['xml:lang']) {
							h_best_label = h_label;
							return true;
						}
					});

					d_space.querySelector('.outgoing>.header>.text').textContext = `"${h_best_label.value}"`;
					d_space.querySelector('.outgoing>.header>a').setAttribute('href', this.loader.resource);

					document.title = '💥.🔗 phuzzy.link - '+h_best_label.value;
				},
			},
		};

		// callback for events
		let af_abstract = this.abstract = [];
		let af_resource = this.resource = [];

		// callbacks for term types
		let af_literal = this.literal = [];
		let af_named_node = this.named_node = [];
		let af_blank_node = this.blank_node = [];

		// miscellaneous
		let af_row = this.row = [];

		// register plugins
		let h_plugins = {};
		if(Array.isArray(this.plugins)) {
			// each plugin
			this.plugins.forEach((h_plugin) => {
				let {
					id: s_id,
					abstract: f_plugin_abstract,
					named_node: f_plugin_named_node,
					blank_node: f_plugin_blank_node,
					literal: f_plugin_literal,
					row: f_plugin_row,
					datatypes: hf_plugin_datatypes,
					predicates: hf_plugin_predicates,
					resource: f_plugin_resource,
				} = h_plugin;

				// id conflict
				if(h_plugins[s_id]) {
					throw `cannot load plugin that has already been loaded or has a conflicting id: ${s_id}`;
				}

				// save plugin
				h_plugins[s_id] = h_plugin;

				// abstract
				if(f_plugin_abstract) {
					af_abstract.push(f_plugin_abstract);
				}

				// resource
				if(f_plugin_resource) {
					af_resource.push(f_plugin_resource);
				}

				// datatypes
				if(hf_plugin_datatypes) {
					// each literal mapping in plugin
					for(let p_iri in hf_plugin_datatypes) {
						let f_literal = hf_plugin_datatypes[p_iri];

						// mapping is not a function; ignore it
						if('function' !== typeof f_literal) {
							console.error(`phuzzy plugin '${s_id}' did not provide a function for an RDF literal mapping at the key '${p_iri}'. ignoring this mapping`);
						}
						// mapping is a function
						else {
							// key will override previous definition
							if(h_datatypes[p_iri]) {
								console.warn(`phuzzy plugin '${s_id}' will override an RDF literal mapping for the IRI '${p_iri}' previously defined by plugin '${h_datatypes[p_iri].owner}'`);
							}

							// define literal mapping
							h_datatypes[p_iri] = {
								owner: s_id,
								load: f_literal,
							};
						}
					}
				}

				// predicates
				if(hf_plugin_predicates) {
					// each preciate mapping in plugin
					for(let p_iri in hf_plugin_predicates) {
						let f_literal = hf_plugin_predicates[p_iri];

						// mapping is not a function; ignore it
						if('function' !== typeof f_literal) {
							console.error(`phuzzy plugin '${s_id}' did not provide a function for an RDF predicate mapping at the key '${p_iri}'. ignoring this mapping`);
						}
						// mapping is a function
						else {
							// key will override previous definition
							if(hf_predicates[p_iri]) {
								console.warn(`phuzzy plugin '${s_id}' will override an RDF predicate mapping for the IRI '${p_iri}' previously defined by plugin '${h_datatypes[p_iri].owner}'`);
							}

							// define literal mapping
							hf_predicates[p_iri] = {
								owner: s_id,
								load: f_literal,
							};
						}
					}
				}

				// values lists
				if(f_plugin_row) {
					af_row.push(f_plugin_row);
				}

				// literals
				if(f_plugin_literal) {
					af_literal.push(f_plugin_literal);
				}

				// named nodes
				if(f_plugin_named_node) {
					af_named_node.push(f_plugin_named_node);
				}

				// blank nodes
				if(f_plugin_blank_node) {
					af_blank_node.push(f_plugin_blank_node);
				}
			});
		}
	}

	serialize(pm_format) {
		// terse resource string
		let s_resource_terse = this.loader.resource_terse;

		// prep serializer
		let dc_serializer = graphy.serializer(pm_format);
		if(!dc_serializer) throw 'graphy cannot serialize to '+pm_format;

		let h_prefixes = this.prefixes || {};
		let h_prefixes_used = {};

		// accumulate outgoing prefixes first
		let as_prefixes_used = this.loader.outgoing.prefixes_used;
		for(let s_prefix of as_prefixes_used) {
			h_prefixes_used[s_prefix] = h_prefixes[s_prefix];
		}

		// outgoing
		let b_finished_outgoing = false;
		let s_comment_outgoing = `   Outgoing properties for '${s_resource_terse}'   `;
		let s_comment_outgoing_border = '+'+'-'.repeat(s_comment_outgoing.length)+'+';
		let k_serializer_outgoing = this.serializer = dc_serializer({
			ready() {
				this.comment([s_comment_outgoing_border, '|'+s_comment_outgoing+'|', s_comment_outgoing_border].join('\n'));
				this.blank_line();
			},
			prefixes: h_prefixes_used,
		});

		// accumulate outgoing
		let s_serialized_outgoing = '';
		k_serializer_outgoing.pipe(new stream.Writable({
			write: (s_chunk, s_encdoing, fk_chunk) => {
				s_serialized_outgoing += s_chunk;
				fk_chunk();
			},
		})).on('finish', () => {
			if(b_finished_incoming) {
				this.machine.edit_rdf(s_serialized_outgoing + s_serialized_incoming, pm_format);
			}
			b_finished_outgoing = true;
		});

		// then make incoming prefixes next
		as_prefixes_used = this.loader.incoming.prefixes_used;
		h_prefixes_used = {};
		for(let s_prefix of as_prefixes_used) {
			h_prefixes_used[s_prefix] = h_prefixes[s_prefix];
		}

		// incoming
		let b_finished_incoming = false;
		let s_comment_incoming = `   Incoming properties for '${s_resource_terse}'   `;
		let s_comment_incoming_border = '+'+'-'.repeat(s_comment_outgoing.length)+'+';
		let k_serializer_incoming = this.serializer = dc_serializer({
			ready() {
				this.comment([s_comment_incoming_border, '|'+s_comment_incoming+'|', s_comment_incoming_border].join('\n'));
				this.blank_line();
			},
			prefixes: h_prefixes_used,
		});

		// accumulate incoming
		let s_serialized_incoming = '\n\n\n';
		k_serializer_incoming.pipe(new stream.Writable({
			write: (s_chunk, s_encdoing, fk_chunk) => {
				s_serialized_incoming += s_chunk;
				fk_chunk();
			},
		})).on('finish', () => {
			if(b_finished_outgoing) {
				this.machine.edit_rdf(s_serialized_outgoing + s_serialized_incoming, pm_format);
			}
			b_finished_incoming = true;
		});


		// // no outgoing triples
		// if(!this.loader.outgoing.stats.triples) 

		// set writer
		let k_writer_outgoing = k_serializer_outgoing.writer;


		// outgoing triples
		let h_outgoing = this.loader.outgoing.triples;
		k_writer_outgoing.add({
			[s_resource_terse]: h_outgoing,
		});
		k_serializer_outgoing.close();


		// incoming triples
		let k_writer_incoming = k_serializer_incoming.writer;

		let h_incoming = this.loader.incoming.triples;
		for(let s_predicate_terse in h_incoming) {
			let a_subjects = h_incoming[s_predicate_terse];
			for(let i_subject=0, n_subjects=a_subjects.length; i_subject<n_subjects; i_subject++) {
				let s_subject_terse = a_subjects[i_subject];
				k_writer_incoming.add({
					[s_subject_terse]: {
						[s_predicate_terse]: s_resource_terse,
					},
				});
			}
		}

		k_serializer_incoming.close();

	}

	// turn a uri into a terse term string
	terse(p_uri) {
		// each prefix
		let h_prefixes = this.prefixes;
		for(let s_prefix in h_prefixes) {
			let p_prefix_iri = h_prefixes[s_prefix];

			// given uri starts with prefix iri
			if(p_uri.startsWith(p_prefix_iri)) {
				return s_prefix+':'+p_uri.substr(p_prefix_iri.length);
			}
		}

		return `<${p_uri}>`;
	}

	verbose(s_tt) {
		let [, s_prefix, s_suffix] = R_TTS_IRI.exec(s_tt);
		return this.prefixes[s_prefix]+s_suffix;
	}

	linkify(p_uri, d_cell, s_label='') {
		let s_resource = this.terse(p_uri);
		let s_text = s_label || s_resource;

		[
			dd('a', {href:`#${s_resource}`, textContent:s_text}),
			dd('a', {
				href: p_uri,
				target: '_blank',
				title: 'dereference URI',
				className: 'fa fa-external-link dereference',
			}),
		].forEach(d_e => d_cell.appendChild(d_e));

		d_cell.classList.add('named-node');

		// let d_link = document.createElement('a');
		// d_link.href = `#${s_resource}`;
		// d_link.textContent = s_text;

		// d_cell.appendChild(d_link);
		// d_cell.classList.add('named-node');

		// let d_external = document.createElement('a');
		// d_external.classList.add('fa', 'fa-external-link');
		// d_cell.appendChild(d_external);

		return s_text;
	}

	// construct an object to return to request.post
	sparql_request(s_query, fk_request) {
		return request.post({
			url: this.endpoint,
			headers: {
				accept: S_MIME_SPARQL_RESULTS,
			},
			form: {
				query: s_query,
			},
		}, fk_request);
	}

	//
	browse(p_resource) {
		// clear previous loader
		if(this.loader) {
			this.loader.clear();
		}

		// set machine
		let k_machine = this.machine;
		k_machine.reset(p_resource);

		// source
		let d_source = this.space.querySelector('.outgoing .header .source');
		d_source.classList.remove('ready');
		d_source.classList.add('loading');

		// instantiate new resource loader
		this.loader = new ResourceLoader(p_resource, this, () => {
			// resource callbacks
			this.resource.forEach((f_resource) => {
				f_resource();
			});

			// rdf display
			d_source.classList.remove('loading');
			d_source.classList.add('ready');
			$(d_source).unbind()
				.click(function() {
					k_machine.toggle();
				});

			// make default
			k_machine.select_format(k_machine.element.formats.querySelector('.graphy [data-mime-format="text/turtle"'));
			this.serialize('text/turtle');
		});
	}

}


// expand terse term string to full iri path
const R_TTS_IRI = /^([^:]*):(.*)$/;

module.exports = Object.assign(function(...a_args) {
	return new Phuzzy(...a_args);
}, {
	tts,

	terse(p_resource, h_prefixes) {
		// each prefix
		for(let s_prefix in h_prefixes) {
			let p_prefix_iri = h_prefixes[s_prefix];

			// given uri starts with prefix iri
			if(p_resource.startsWith(p_prefix_iri)) {
				return s_prefix+':'+p_resource.substr(p_prefix_iri.length);
			}
		}

		return `<${p_resource}>`;
	},
});
