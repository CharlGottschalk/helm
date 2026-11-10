/** An error safe to show the browser, with the HTTP status to use. */
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}
