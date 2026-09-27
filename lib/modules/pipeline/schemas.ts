import {z} from 'zod';
const nullableId=z.string().max(191).nullable().optional().or(z.literal('').transform(()=>null));
export const tenderInput=z.object({
 opportunityId:z.string().max(191).nullable().optional(),
 title:z.string().trim().max(255).optional(),
 clientName:z.string().trim().max(255).nullable().optional(),
 reference:z.string().trim().max(80).nullable().optional(),
 dueDate:z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/).nullable().optional().or(z.literal('').transform(()=>null)),
 estimatedValue:z.coerce.number().min(0).max(1e12).nullable().optional(),
 ownerUserId:nullableId,
 location:z.string().max(255).nullable().optional(),
 scopeSummary:z.string().max(20000).nullable().optional(),
});
