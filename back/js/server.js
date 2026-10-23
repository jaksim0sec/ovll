/** Beta HTTP entry point; backend-owned assets, no automatic local Canvas import. */
import {createBetaRuntime} from './runtime.js';
const {server}=createBetaRuntime();
const port=Number(process.env.PORT)||10000;
server.listen(port,'0.0.0.0',()=>console.log('Ovll beta HTTP service listening on '+port));
