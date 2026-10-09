import { Component, type ComponentType, lazy, type ReactNode, Suspense } from 'react';
import { localExamples } from './registry';
import BrowserOnly from '@docusaurus/BrowserOnly';
import { stripHarness } from '@pixi-react-provisional/examples/harness/strip';
import CodeBlock from '@theme/CodeBlock';
import TabItem from '@theme/TabItem';
import Tabs from '@theme/Tabs';

const SOURCE_URL = 'https://github.com/baseten/pixi-react/blob/main/apps/examples/src/examples/';
const previews = new Map<string, ComponentType>();

function previewOf(id: string): ComponentType
{
    if (!previews.has(id)) previews.set(id, lazy(localExamples[id].load));

    return previews.get(id)!;
}

class PreviewBoundary extends Component<{ children?: ReactNode }, { error: unknown }>
{
    state = { error: null as unknown };

    static getDerivedStateFromError(error: unknown)
    {
        return { error };
    }

    render()
    {
        return this.state.error
            ? <p className="local-example__error">The preview failed: {String(this.state.error)}</p>
            : this.props.children;
    }
}

const fileName = (path: string) => path.split('/').pop()!;

/**
 * One example from apps/examples: a live preview rendered with the @pixi/react build these docs were built from, and
 * the source of each of its files. The page code and the example app share the same files.
 */
export function LocalExample({ id }: { id: string })
{
    const example = localExamples[id];

    if (!example) throw new Error(`No docs example "${id}" (see apps/examples/src/catalog.json)`);
    const Preview = previewOf(id);
    const code = (path: string, source: string) => (
        <CodeBlock language={path.endsWith('.tsx') ? 'tsx' : 'ts'} title={fileName(path)}>
            {stripHarness(source).trim()}
        </CodeBlock>
    );

    return (
        <div className="local-example">
            <p className="local-example__label">
                Live preview, rendered by the <code>@pixi/react</code> build these docs were built from (this
                repository&apos;s workspace packages, not npm). Source:{' '}
                {example.files.map((file, index) => (
                    <span key={file.path}>
                        {index ? ', ' : ''}
                        <a href={`${SOURCE_URL}${file.path}`}>{fileName(file.path)}</a>
                    </span>
                ))}
            </p>
            <div className="local-example__preview">
                <BrowserOnly fallback={<p>Loading the preview…</p>}>
                    {() => (
                        <PreviewBoundary>
                            <Suspense fallback={<p>Loading the preview…</p>}>
                                <Preview />
                            </Suspense>
                        </PreviewBoundary>
                    )}
                </BrowserOnly>
            </div>
            {example.files.length === 1
                ? code(example.files[0].path, example.files[0].code)
                : (
                    <Tabs>
                        {example.files.map((file) => (
                            <TabItem key={file.path} value={file.path} label={fileName(file.path)}>
                                {code(file.path, file.code)}
                            </TabItem>
                        ))}
                    </Tabs>
                )}
        </div>
    );
}
