import { runService } from "./index";

(async () => {
    console.log('Running service v1.1.0...')
    return runService(process.env.API_PORT);
})();
