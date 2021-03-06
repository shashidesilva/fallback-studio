const path = require('path');
const parentTheme = path.resolve(process.cwd() + '/../../pwa-studio/packages/venia-concept');
const validEnv = require(`${parentTheme}/validate-environment`)(process.env);
const webpack = require('webpack');
const {
    WebpackTools: {
        makeMagentoRootComponentsPlugin,
        ServiceWorkerPlugin,
        MagentoResolver,
        UpwardPlugin,
        PWADevServer
    }
} = require('@magento/pwa-buildpack');
const babelEnvDeps = require('webpack-babel-env-deps');
const TerserPlugin = require('terser-webpack-plugin');
const configureBabel = require(path.resolve(parentTheme, 'babel.config.js'));

const themePaths = {
    images: path.resolve(__dirname, 'images'),
    templates: path.resolve(__dirname, 'templates'),
    src: path.resolve(__dirname, 'src'),
    output: path.resolve(__dirname, 'dist')
};

const rootComponentsDirs = [
    path.resolve(parentTheme, 'src/RootComponents/'),
    './src/RootComponents/'
];

const libs = [
    'apollo-boost',
    'react',
    'react-dom',
    'react-redux',
    'react-router-dom',
    'redux'
];

module.exports = async function(env) {
    const mode = (env && env.mode) || process.env.NODE_ENV || 'development';

    const babelOptions = configureBabel(mode);

    const enableServiceWorkerDebugging =
        validEnv.ENABLE_SERVICE_WORKER_DEBUGGING;

    const serviceWorkerFileName = validEnv.SERVICE_WORKER_FILE_NAME;

    const config = {
        mode,
        context: __dirname, // Node global for the running script's directory
        entry: {
            client: path.resolve(themePaths.src, 'index.js')
        },
        output: {
            path: themePaths.output,
            publicPath: '/',
            filename: 'js/[name].js',
            strictModuleExceptionHandling: true,
            chunkFilename: 'js/[name]-[chunkhash].js'
        },
        module: {
            rules: [
                {
                    test: /\.graphql$/,
                    exclude: /node_modules/,
                    use: [
                        {
                            loader: 'graphql-tag/loader'
                        }
                    ]
                },
                {
                    include: [
                        themePaths.src,
                        /peregrine\/src\//,
                        babelEnvDeps.include(),
                        path.resolve(parentTheme, 'src')
                    ],
                    test: /\.(mjs|js)$/,
                    use: [
                        {
                            loader: 'babel-loader',
                            options: { ...babelOptions, cacheDirectory: true }
                        }
                    ]
                },
                {
                    test: /\.css$/,
                    use: [
                        'style-loader',
                        {
                            loader: 'css-loader',
                            options: {
                                importLoaders: 1,
                                localIdentName:
                                    '[name]-[local]-[hash:base64:3]',
                                modules: true
                            }
                        }
                    ]
                },
                {
                    test: /\.scss$/,
                    // Exclude files from these locations
                    exclude: /node_modules|bower_components/,
                    // fallback: 'style-loader',
                    use: [
                        // Default style loader
                        'style-loader',
                        // CSS loader
                        {
                            loader: 'css-loader',
                            // Scepcify options for the CSS loader
                            options: {
                                // Root - must be specified in order to resolve URLs
                                // in css files and pick up on any images and fonts.
                                //root: paths.appSrc,
                                importLoaders: 2,
                                localIdentName:
                                    '[name]-[local]-[hash:base64:3]',
                                modules: true,
                            }
                        },
                        //reason we don't watch scss and css at the same time sass-loader see https://github.com/sass/node-sass/issues/2251
                        //SASS loader
                        {
                            loader: 'sass-loader',
                            options: {
                                data: '@import "./src/styles/core";',
                            }
                        }
                    ],
                },
                {
                    test: /\.(jpg|svg)$/,
                    use: [
                        {
                            loader: 'file-loader',
                            options: {}
                        }
                    ]
                }
            ]
        },
        resolve: {
            modules: [__dirname, 'node_modules', parentTheme],
            mainFiles: ['index'],
            extensions: ['.mjs', '.js', '.json', '.graphql'],
            alias: {
                parentSrc: path.resolve(parentTheme, 'src'),
                parentComponents: path.resolve(parentTheme, 'src/components'),
                parentQueries: path.resolve(parentTheme, 'src/queries')
            }

        },
        plugins: [
            await makeMagentoRootComponentsPlugin({
                rootComponentsDirs,
                context: __dirname
            }),
            new webpack.DefinePlugin({
                'process.env': {
                    NODE_ENV: JSON.stringify(mode),
                    // Blank the service worker file name to stop the app from
                    // attempting to register a service worker in index.js.
                    // Only register a service worker when in production or in the
                    // special case of debugging the service worker itself.
                    SERVICE_WORKER: JSON.stringify(
                        mode === 'production' || enableServiceWorkerDebugging
                            ? serviceWorkerFileName
                            : false
                    )
                }
            }),
            new ServiceWorkerPlugin({
                env: { mode },
                enableServiceWorkerDebugging,
                serviceWorkerFileName,
                paths: themePaths,
                injectManifest: true,
                injectManifestConfig: {
                    include: [/\.js$/],
                    swSrc: path.resolve(parentTheme, 'src/sw.js'),
                    swDest: 'sw.js'
                }
            })
        ],
        optimization: {
            splitChunks: {
                cacheGroups: {
                    vendor: {
                        test: new RegExp(
                            `[\\\/]node_modules[\\\/](${libs.join('|')})[\\\/]`
                        ),
                        name: true,
                        filename: 'js/vendor.js',
                        chunks: 'all'
                    }
                }
            }
        }
    };
    if (mode === 'development') {
        config.devtool = 'eval-source-map';

        const devServerConfig = {
            publicPath: config.output.publicPath,
            graphqlPlayground: {
                queryDirs: [
                    path.resolve(themePaths.src, 'queries'),
                    path.resolve(parentTheme, 'src/queries')
                ]
            }
        };
        const provideHost = !!validEnv.MAGENTO_BUILDPACK_PROVIDE_SECURE_HOST;
        if (provideHost) {
            devServerConfig.provideSecureHost = {
                subdomain: validEnv.MAGENTO_BUILDPACK_SECURE_HOST_SUBDOMAIN,
                exactDomain:
                    validEnv.MAGENTO_BUILDPACK_SECURE_HOST_EXACT_DOMAIN,
                addUniqueHash: !!validEnv.MAGENTO_BUILDPACK_SECURE_HOST_ADD_UNIQUE_HASH
            };
        }
        config.devServer = await PWADevServer.configure(devServerConfig);

        // A DevServer generates its own unique output path at startup. It needs
        // to assign the main outputPath to this value as well.

        config.output.publicPath = config.devServer.publicPath;

        config.plugins.push(
            new webpack.HotModuleReplacementPlugin(),
            new UpwardPlugin(
                config.devServer,
                validEnv,
                path.resolve(__dirname, validEnv.UPWARD_JS_UPWARD_PATH)
            )
        );
    } else if (mode === 'production') {
        config.performance = {
            hints: 'warning'
        };
        if (!process.env.DEBUG_BEAUTIFY) {
            config.optimization.minimizer = [
                new TerserPlugin({
                    parallel: true,
                    cache: true,
                    terserOptions: {
                        ecma: 8,
                        parse: {
                            ecma: 8
                        },
                        compress: {
                            drop_console: true
                        },
                        output: {
                            ecma: 7,
                            semicolons: false
                        },
                        keep_fnames: true
                    }
                })
            ];
        }
    } else {
        throw Error(`Unsupported environment mode in webpack config: ${mode}`);
    }
    return config;
};
