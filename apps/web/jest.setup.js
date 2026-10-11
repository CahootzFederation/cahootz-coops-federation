/* eslint-disable @typescript-eslint/require-await */
import '@testing-library/jest-dom'

// Mock environment variables for tests
process.env.NODE_ENV = 'test'
process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test-webhook'

// Mock fetch globally
global.fetch = jest.fn()

// Mock NextRequest and NextResponse for API route tests
global.Request = class Request {
  constructor(input, init) {
    this.url = input
    this.method = init?.method || 'GET'
    this.headers = new Map(Object.entries(init?.headers || {}))
    this._body = init?.body
  }
  
  async json() {
    return JSON.parse(this._body)
  }
}

global.Response = class Response {
  constructor(body, init) {
    this.body = body
    this.status = init?.status || 200
    this.headers = new Map(Object.entries(init?.headers || {}))
  }
  
  async json() {
    return JSON.parse(this.body)
  }
}
