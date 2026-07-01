/**
 * Helper to generate a safe document ID for Firestore products.
 * Firestore document IDs cannot contain slashes ('/'), otherwise they are parsed
 * as subcollections, leading to "odd number of segments" path errors.
 */
export function getSafeProductId(customer: string, partNo: string): string {
  if (!customer || !partNo) return "";
  const cleanCustomer = customer.trim().toUpperCase();
  const cleanPartNo = partNo.trim();
  return `${cleanCustomer}-${cleanPartNo}`.replace(/\//g, "___");
}
