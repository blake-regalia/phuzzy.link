const pug = require('pug');

module.exports = function(gulp, $, p_src, p_dest) {

	// build stream
	return gulp.src([p_src+'/**/*.pug'])
		// // only proceed with files that have changed
		// .pipe($.cached(s_task))

		// handle uncaught exceptions thrown by any of the plugins that follow
		.pipe($.plumber())

		// compile pug => html
		.pipe($.pug({
			pug: pug,
			pretty: true,
			locals: {
				site: {
					// data: h_site_data,
				},
			},
		}))

		// // compress html
		// .pipe($.htmlmin({
		// 	collapseBooleanAttributes: true,
		// 	conservativeCollapse: true,
		// 	removeCommentsFromCDATA: true,
		// 	removeEmptyAttributes: true,
		// 	removeRedundantAttributes: true,
		// }))

		.pipe($.rename((...a_args) => {
			if(this.options.rename) this.options.rename(...a_args);
		}))

		// write to output directory
		.pipe(gulp.dest(p_dest));
};

module.exports.dependencies = [
	'pug',
	'gulp-plumber',
	'gulp-pug',
	'gulp-rename',
];
