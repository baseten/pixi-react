// Installs the built React 19 minor package into the current fixture (see config.mjs); run before typechecking it.
import { installBuiltPackage } from './config.mjs';

installBuiltPackage(process.cwd());
