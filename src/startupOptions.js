function shouldOpenDevTools(isPackaged, argv = process.argv) {
    return !isPackaged && argv.includes('--devtools');
}

function shouldCheckForUpdates(isPackaged, localBuild, env = process.env) {
    return isPackaged && !localBuild && env.NODE_ENV !== 'development';
}

module.exports = { shouldOpenDevTools, shouldCheckForUpdates };
