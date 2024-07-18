import { runService } from "./index";

(async () => {
    console.log('Running service v1.0.1...')
    return runService(process.env.API_PORT);
})();
