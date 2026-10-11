/**
 * The first setup file of every run (vitest.config.mts): registers the page-crash watch of the `compatBrowser` command
 * before anything initializes or renders, so a crash at any point fails the run at once instead of leaving Vitest
 * waiting until the runner's timeout. WebGL runs would otherwise register it only when backend.test.tsx describes the
 * browser, after the render check.
 */
import { commands } from '@vitest/browser/context';

await (commands as Record<string, any>).compatBrowser();
