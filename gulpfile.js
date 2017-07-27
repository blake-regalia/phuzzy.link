//
const path = require('path');

// gulp & tasker
const gulp = require('gulp');
const soda = require('gulp-soda');

// // gulp user-level config
// let h_user_config = {};
// try {
// 	h_user_config = require('./config.user.js');
// } catch(e) {} // eslint-disable-line

// 
soda(gulp, {
	// // pass user config
	// config: h_user_config,

	// 
	inputs: {
		main: 'node',
		webapp: 'bundle',
	},

	// 
	targets: {
		node: [
			'copy',
		],

		// webapp development
		bundle: [
			'[all]: less pug browserify copy',
			'less',
			'pug',
			'browserify',
			'copy',
			'browser-sync: all',
			'develop: all',
		],
	},

	// task options
	options: {
		less: {
			watch: '**/*.less',
			rename: h => h.dirname = './_styles',
		},
		pug: {
			watch: '**/*.pug',
			// rename: h => h.dirname = h.dirname.replace(/^src/, '.'),
		},
		browserify: {
			watch: '**/*.js',
			src: '_scripts',
			rename: h => h.dirname = path.join('_scripts', h.dirname),
		},
		'copy-webapp': {
			src: 'source',
			rename: h => h.dirname = 'source',
		},
	},

	// //
	// aliases: {
	// 	serve: ['reload-proxy', 'develop-webapp', 'browser-sync'],
	// },
});
