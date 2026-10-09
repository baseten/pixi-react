import { useState } from 'react';
import releasePins from '../../release-pins.json';
import { dracula } from './defaults/theme';
import { EditorLayout } from './Sandpack/Layout';
import StylesFile from '!!raw-loader!./defaults/styles.css';
import { SandpackProvider } from '@codesandbox/sandpack-react';
import { githubLight } from '@codesandbox/sandpack-themes';
import BrowserOnly from '@docusaurus/BrowserOnly';
import { useColorMode } from '@docusaurus/theme-common';

export interface EditorProps
{
    viewType?: 'both' | 'editor' | 'preview';
    showConsole?: boolean;
    width?: number | string;
    height?: number | string;
    /** The docs version whose pins the example uses: `v8` is the current docs, `v7` the 7.x snapshot. */
    version?: 'v7' | 'v8';
    /** Packages beyond the pinned four that the example imports; their exact versions are that docs version's `extras`. */
    extras?: string[];
    files?: Record<string, { code: string; hidden?: boolean; active?: boolean } | string>;
    fontSize?: number;
    handleEditorCodeChanged?: (nextSourceCode: string | undefined) => void;
}

/**
 * Exact package versions per docs version, generated from the release (scripts/release/docs-pins.mjs). Examples never
 * choose their own versions, so every example runs the release's tested React and pixi.js, never `latest`.
 */
const pins: Record<NonNullable<EditorProps['version']>, { dependencies: Record<string, string>; extras?: Record<string, string> }> = {
    v7: releasePins.frozen['7.x'],
    v8: releasePins.current,
};

function pinnedDependencies(version: NonNullable<EditorProps['version']>, extras: string[]): Record<string, string>
{
    const { dependencies, extras: pinnedExtras = {} } = pins[version];
    const missing = extras.filter((name) => !pinnedExtras[name]);

    if (missing.length)
    {
        throw new Error(`release-pins.json has no ${version} pin for ${missing.join(', ')}`);
    }

    return { ...dependencies, ...Object.fromEntries(extras.map((name) => [name, pinnedExtras[name]])) };
}

export function Editor({
    viewType = 'both',
    showConsole = false,
    width = '100%',
    height = '100%',
    version = 'v8',
    extras = [],
    files = {},
    fontSize = 12,
    handleEditorCodeChanged,
}: EditorProps)
{
    const { colorMode } = useColorMode();

    const filesWithoutIndexJs = { ...files };

    // delete filesWithoutIndexJs['App.js'];

    const [filesState] = useState({
        '/styles.css': { code: StylesFile, hidden: true },
        'sandbox.config.json': { code: `{"infiniteLoopProtection": false}`, hidden: true },
        '/public/index.html': {
            code: `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Document</title>
            </head>
            <body>
                <div id="root"></div>
            </body>
            </html>`,
            hidden: true,
        },
        '/index.js': {
            code: `import React from "react";
            import { createRoot } from "react-dom/client";
            import "./styles.css";

            import App from "./App";

            const root = createRoot(document.getElementById("root"));
            root.render(
                <App />
            );`,
            hidden: true,
        },
        ...filesWithoutIndexJs,
    });

    const dependencies = pinnedDependencies(version, extras);

    const published = Object.entries(dependencies).map(([name, pinned]) => `${name} ${pinned}`).join(', ');

    return (
        <>
            {/* Sandpack fetches the packages from npm: this sandbox never runs the repository's own build. */}
            <p className="sandpack-source-label">
                Interactive sandbox: runs in CodeSandbox with the published npm packages ({published}), not this
                repository&apos;s local build. It is not part of the repository&apos;s test evidence.
            </p>
            <BrowserOnly>
                {() => (
                    <SandpackProvider
                        template="react"
                        theme={colorMode === 'dark' ? dracula : githubLight}
                        files={filesState}
                        customSetup={{ dependencies }}
                        style={{ height, width, margin: '0 auto', maxWidth: '100%' }}
                        options={{ recompileDelay: 500 }}>
                        <EditorLayout
                            fontSize={fontSize}
                            handleEditorCodeChanged={handleEditorCodeChanged}
                            pixiVersion={dependencies['pixi.js']}
                            showConsole={showConsole}
                            viewType={viewType} />
                    </SandpackProvider>
                )}
            </BrowserOnly>
        </>
    );
}
