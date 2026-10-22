import { requireTrustedOrigin } from '../../middleware/trustedOrigin';
import { createEnterpriseConnection, listEnterpriseConnections, deleteEnterpriseConnection, startEnterpriseSignIn, EnterpriseAccessError } from '../../lib/enterpriseSignIn';
import { sendInvitationMail } from '../../lib/mail';
// Express router for organizations + RBAC, mounted at /orgs.
//
// Thin handlers: they read res.locals (userId/userEmail set by requireAuth),
// delegate to orgs.service.ts, and map the discriminated results onto HTTP
// status codes with {detail} bodies — mirroring modules/projects.
//
// Note what is NOT here: there is no "add a member" endpoint. Membership is
// created by accepting an invitation (POST /orgs/:orgId/invitations here,
// POST /user/invitations/:id/accept in modules/user/user.routes.ts), so an
// admin can never pull somebody into a workspace full of confidential
// material without them agreeing to it.

import { Router } from "express";
import { requireAuth, requireMfaIfEnrolled } from "../../middleware/auth";
import { asyncRoute, routerErrorHandler, type AsyncRoute } from "../../middleware/asyncRoute";
import { createServerSupabase } from "../../lib/supabase";
import { sendOrgFailure } from "../../lib/orgFailure";
import {
    listMyOrgs,
    createOrg,
    getOrg,
    updateOrg,
    deleteOrg,
    listOrgResources,
    listMembers,
    updateMember,
    removeMember,
    createInvitation,
    listInvitations,
    cancelInvitation,
    resendInvitation,
} from "./orgs.service";

export const orgsRouter = Router();

// GET /orgs — orgs the caller belongs to (with their role + member count).
orgsRouter.get("/", requireAuth, asyncRoute(async (_req, res) => {
    const userId = res.locals.userId as string;
    const db = createServerSupabase();
    const result = await listMyOrgs(db, userId);
    if (!result.ok) return sendOrgFailure(res, result);
    res.json(result.orgs);
}));

// POST /orgs — create an org; the caller becomes its first admin.
orgsRouter.post("/", requireAuth, asyncRoute(async (req, res) => {
    const userId = res.locals.userId as string;
    const db = createServerSupabase();
    const result = await createOrg(db, { userId, name: req.body?.name });
    if (!result.ok) return sendOrgFailure(res, result);
    res.status(201).json(result.org);
}));

// GET /orgs/:orgId — org detail (any member).
orgsRouter.get("/:orgId", requireAuth, asyncRoute(async (req, res) => {
    const userId = res.locals.userId as string;
    const db = createServerSupabase();
    const result = await getOrg(db, { userId, orgId: req.params.orgId });
    if (!result.ok) return sendOrgFailure(res, result);
    res.json(result.org);
}));

// PATCH /orgs/:orgId — rename the org (admin only).
orgsRouter.patch("/:orgId", requireAuth, asyncRoute(async (req, res) => {
    const userId = res.locals.userId as string;
    const db = createServerSupabase();
    const result = await updateOrg(db, {
        userId,
        orgId: req.params.orgId,
        name: req.body?.name,
    });
    if (!result.ok) return sendOrgFailure(res, result);
    res.json(result.org);
}));

// DELETE /orgs/:orgId — delete an empty org (admin only). Organization-owned
// resources never become personal data as a side effect of deletion.
orgsRouter.delete("/:orgId", requireAuth, asyncRoute(async (req, res) => {
    const userId = res.locals.userId as string;
    const db = createServerSupabase();
    const result = await deleteOrg(db, {
        userId,
        userEmail: res.locals.userEmail as string | undefined,
        orgId: req.params.orgId,
    });
    if (!result.ok) return sendOrgFailure(res, result);
    res.status(204).send();
}));

// GET /orgs/:orgId/resources — every organization-scoped project and workflow.
// Chats and tabular reviews only inherit organization access from projects and
// are browsed inside those projects rather than as independent org resources.
orgsRouter.get("/:orgId/resources", requireAuth, asyncRoute(async (req, res) => {
    const userId = res.locals.userId as string;
    const db = createServerSupabase();
    const result = await listOrgResources(db, {
        userId,
        orgId: req.params.orgId,
    });
    if (!result.ok) return sendOrgFailure(res, result);
    res.json({
        projects: result.projects,
        workflows: result.workflows,
    });
}));

// GET /orgs/:orgId/members — the accepted roster (any member).
orgsRouter.get("/:orgId/members", requireAuth, asyncRoute(async (req, res) => {
    const userId = res.locals.userId as string;
    const db = createServerSupabase();
    const result = await listMembers(db, { userId, orgId: req.params.orgId });
    if (!result.ok) return sendOrgFailure(res, result);
    res.json(result.members);
}));

// PATCH /orgs/:orgId/members/:userId — change a member's role (admin only).
orgsRouter.patch("/:orgId/members/:userId", requireAuth, asyncRoute(async (req, res) => {
    const userId = res.locals.userId as string;
    const db = createServerSupabase();
    const result = await updateMember(db, {
        actorId: userId,
        actorEmail: res.locals.userEmail as string | undefined,
        orgId: req.params.orgId,
        targetUserId: req.params.userId,
        role: req.body?.role,
    });
    if (!result.ok) return sendOrgFailure(res, result);
    res.json(result.member);
}));

// DELETE /orgs/:orgId/members/:userId — remove a member (admin, or self).
orgsRouter.delete("/:orgId/members/:userId", requireAuth, asyncRoute(async (req, res) => {
    const userId = res.locals.userId as string;
    const db = createServerSupabase();
    const result = await removeMember(db, {
        actorId: userId,
        actorEmail: res.locals.userEmail as string | undefined,
        orgId: req.params.orgId,
        targetUserId: req.params.userId,
    });
    if (!result.ok) return sendOrgFailure(res, result);
    res.status(204).send();
}));

// ---------------------------------------------------------------------------
// Invitations (admin side)
// ---------------------------------------------------------------------------

// POST /orgs/:orgId/invitations — invite an email at a role (admin only).
orgsRouter.post("/:orgId/invitations", requireAuth, asyncRoute(async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const db = createServerSupabase();
    const result = await createInvitation(db, {
        actorId: userId,
        actorEmail: userEmail,
        orgId: req.params.orgId,
        email: req.body?.email,
        role: req.body?.role,
    });
    if (!result.ok) return sendOrgFailure(res, result);
    await sendInvitationMail(result.invitation);
    res.status(201).json(result.invitation);
}));

// GET /orgs/:orgId/invitations — pending/recent invitations (admin only).
orgsRouter.get("/:orgId/invitations", requireAuth, asyncRoute(async (req, res) => {
    const userId = res.locals.userId as string;
    const db = createServerSupabase();
    const result = await listInvitations(db, {
        userId,
        orgId: req.params.orgId,
    });
    if (!result.ok) return sendOrgFailure(res, result);
    res.json(result.invitations);
}));

// DELETE /orgs/:orgId/invitations/:invitationId — cancel (admin only).
orgsRouter.delete(
    "/:orgId/invitations/:invitationId",
    requireAuth,
    asyncRoute(async (req, res) => {
        const userId = res.locals.userId as string;
        const userEmail = res.locals.userEmail as string | undefined;
        const db = createServerSupabase();
        const result = await cancelInvitation(db, {
            actorId: userId,
            actorEmail: userEmail,
            orgId: req.params.orgId,
            invitationId: req.params.invitationId,
        });
        if (!result.ok) return sendOrgFailure(res, result);
        res.status(204).send();
    }),
);

// POST /orgs/:orgId/invitations/:invitationId/resend — refresh expiry.
//
// An explicit resend refreshes expiry and delivers through the shared mail capability.
orgsRouter.post(
    "/:orgId/invitations/:invitationId/resend",
    requireAuth,
    asyncRoute(async (req, res) => {
        const userId = res.locals.userId as string;
        const userEmail = res.locals.userEmail as string | undefined;
        const db = createServerSupabase();
        const result = await resendInvitation(db, {
            actorId: userId,
            actorEmail: userEmail,
            orgId: req.params.orgId,
            invitationId: req.params.invitationId,
        });
        if (!result.ok) return sendOrgFailure(res, result);
        await sendInvitationMail(result.invitation);
        res.json(result.invitation);
    }),
);



function enterpriseRoute(handler:AsyncRoute) {
 return asyncRoute(async(req,res)=>{try {await handler(req,res);}catch(error){
  res.status(error instanceof EnterpriseAccessError ? 403 : 503).json({detail:error instanceof EnterpriseAccessError ? 'You do not have permission to manage this organization sign-in connection.' : 'Organization sign-in could not complete. Check existing connections before trying again; the service may not be available yet.'});
 }});
}
orgsRouter.use('/:orgId/sign-in-connections',requireTrustedOrigin);
orgsRouter.get('/:orgId/sign-in-connections',requireAuth,enterpriseRoute(async(req,res)=>{
 const result=await listEnterpriseConnections(createServerSupabase(),res.locals.userId,req.params.orgId,typeof req.query.cursor==='string'?req.query.cursor:undefined);res.json(result);
}));
orgsRouter.post('/:orgId/sign-in-connections',requireAuth,requireMfaIfEnrolled,enterpriseRoute(async(req,res)=>{
 const result=await createEnterpriseConnection(createServerSupabase(),res.locals.userId,req.params.orgId,req.body);res.status(201).json(result);
}));
orgsRouter.delete('/:orgId/sign-in-connections/:connectionId',requireAuth,requireMfaIfEnrolled,enterpriseRoute(async(req,res)=>{
 await deleteEnterpriseConnection(createServerSupabase(),res.locals.userId,req.params.orgId,req.params.connectionId);res.json({deleted:true});
}));
orgsRouter.post('/:orgId/sign-in-connections/:connectionId/link',requireAuth,requireMfaIfEnrolled,enterpriseRoute(async(req,res)=>{
 const result=await startEnterpriseSignIn(createServerSupabase(),req.params.orgId,req.params.connectionId,res.locals.userId);
 res.cookie('legal-assistant-enterprise',result.ticket,{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:600000});res.json({url:result.url});
}));

orgsRouter.use(routerErrorHandler("[orgs]"));
