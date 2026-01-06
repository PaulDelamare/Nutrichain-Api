// ! IMPORTS
import { router } from "../Configs/router.config";
import { HelloController } from "../Controllers/hello.controller";
import { checkApiKey } from "../Utils/checkApiKey/checkApiKey";

// ! Requêtes
router.get('/hello', HelloController.helloWorld);

router.post('/error', HelloController.errorRequest);

router.post('/service', checkApiKey(), HelloController.serviceExemple);

// ! EXPORT
export default router
