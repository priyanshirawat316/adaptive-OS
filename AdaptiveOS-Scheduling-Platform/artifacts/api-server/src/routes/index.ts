import { Router, type IRouter } from "express";
import adaptiveosRouter from "./adaptiveos";
import communityRouter from "./community";
import healthRouter from "./health";

const router: IRouter = Router();

router.use(healthRouter);
router.use(adaptiveosRouter);
router.use(communityRouter);

export default router;
