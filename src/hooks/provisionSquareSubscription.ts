import type { CollectionAfterChangeHook } from 'payload'
import { squareMembershipGateway } from '../lib/membership-gateway'
import { provisionMemberSubscription } from '../services/membership'
import type { Member } from '../payload-types'

/**
 * When staff create an ACTIVE member in the admin, set them up in Square:
 * a customer + cardless subscription (Square emails the invoice). Skips members
 * that already carry Square ids (self-serve signup / import) and changes driven
 * by our own write-back or the Square webhook.
 */
export const provisionSquareSubscription: CollectionAfterChangeHook<Member> = async ({ doc, operation, req }) => {
  if (operation !== 'create') return doc
  if (req?.context?.fromMemberHook) return doc
  if (req?.context?.fromSquareWebhook) return doc
  if (doc.squareSubscriptionId) return doc
  if (doc.status !== 'active') return doc

  try {
    await provisionMemberSubscription(
      { payload: req.payload, gateway: squareMembershipGateway, req },
      { id: doc.id, name: doc.name, email: doc.email, phone: doc.phone },
    )
  } catch (e) {
    // provisionMemberSubscription already records SETUP_FAILED; this is a backstop
    // so a thrown error never breaks the admin save.
    console.error(`Member ${doc.id} provisioning hook error:`, e)
  }
  return doc
}
