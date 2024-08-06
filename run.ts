import { runService } from "./index";

(async () => {
    console.log('Running service v1.1.2...')
    return runService(process.env.API_PORT);
})();
