export type { FakeApplicationOptions, FakeNodeDestroyOptions, FakeTextStyle } from './nodes';
export {
    FAKE_DEFAULT_TEXT_STYLE,
    FakeApplication,
    FakeContainer,
    FakeGraphics,
    FakePoint,
    FakeResource,
    FakeSprite,
    FakeText,
    FakeTicker,
} from './nodes';
export type { FakeNodeDefinition, FakeSceneFaults, FakeSceneSessionOptions } from './session';
export { applyFakeProps, dispatchFakeEvent, FakeSceneSession, sceneEventName } from './session';
