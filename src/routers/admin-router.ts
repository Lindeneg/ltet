import {Router, type RequestHandler} from "express";

export function makeAdminRouter(
    sameOrigin: RequestHandler,
    publicRouter: Router,
    adminAuth: RequestHandler,
    protectedRouters: Router[]
): Router {
    const router = Router();

    router.use(sameOrigin);
    router.use(publicRouter);

    router.use(adminAuth);
    for (const protectedRouter of protectedRouters) {
        router.use(protectedRouter);
    }

    return router;
}
