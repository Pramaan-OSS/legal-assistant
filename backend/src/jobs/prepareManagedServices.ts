import { UserFacingError } from '../lib/userFacingError';
import { prepareDatabase, prepareManagedSignIn, writePublicSignInConfiguration, runtimeDirectory } from '../lib/managedServices';
void (async()=>{await prepareManagedSignIn(runtimeDirectory());await prepareDatabase(runtimeDirectory());writePublicSignInConfiguration(runtimeDirectory());})().catch((error: unknown)=>{
  console.error(error instanceof UserFacingError ? error.message : 'Managed setup could not finish. Check the private runtime configuration before trying again.');
  process.exitCode=1;
});
