// Services whose orders hold private information (a bank statement and what it shows). Their briefs, details, step
// notes and deliverables never appear on public surfaces: the job page needs the key from the customer's email,
// the live office and traction show only the service name, and step updates go out without their notes.
export const PRIVATE_SERVICES = new Set(['money-report']);
export const isPrivate = (service: string) => PRIVATE_SERVICES.has(service);
