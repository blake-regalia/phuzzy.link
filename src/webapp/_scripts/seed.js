
const drag_drop = require('drag-drop');
const webtorrent = require('webtorrent');
const graphy = require('graphy');
const dd = require('./dd.js');

function select_ttl_file() {
	let daf_files = this.files;
	let df_file = daf_files[0];
	if(!df_file.name.endsWith('.ttl')) {
		alert('File name must end with ".ttl"');
	}

	convert_ttl(df_file);
}

function convert_ttl(df_ttl) {
	graphy.bat.create(df_ttl, {
		mime: 'text/turtle',

		progress(s_task, h_config) {
			
		},

		ready(p_output) {
			let d_download = dd('a:Save BAT file', {
				href: p_output,
				download: df_ttl.name.replace(/\.\w+$/, '')+'.bat',
			});

			document.body.appendChild(d_download);
		},
	});
}

document.addEventListener('DOMContentLoaded', () => {
	// drag and drop listener
	drag_drop(document.body, select_ttl_file);

	// file input button listener
	document.getElementById('convert-ttl').addEventListener('change', select_ttl_file, false);
});
