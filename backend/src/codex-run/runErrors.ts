export class RunRequestError extends Error {
  statusCode: number

  constructor(statusCode: number, message: string) {
    super(message)
    this.name = "RunRequestError"
    this.statusCode = statusCode
  }
}

