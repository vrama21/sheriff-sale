import { HttpClient } from '../../../shared/http';

/**
 * A salesweb.civilview.com client with its own ASP.NET session.
 *
 * The site scopes a session to the county it last searched, so each county run creates its own client:
 * the county search sets the session cookie, and the client sends it on that county's details requests.
 */
export class NewJerseySheriffSaleHttpClient extends HttpClient {
  public aspSessionId: string;

  public constructor() {
    super({
      baseURL: 'https://salesweb.civilview.com',
      // A hung socket would otherwise hold a listing limiter slot until the Lambda times out.
      timeout: 30_000,
      withCredentials: true,
    });

    this.axiosInstance.interceptors.request.use(
      (req) => {
        if (this.aspSessionId) {
          req.headers['Cookie'] = `ASP.NET_SessionId=${this.aspSessionId}`;
        }

        return req;
      },
      (error) => {
        throw error;
      },
    );

    this.axiosInstance.interceptors.response.use(
      (res) => {
        const cookies: string[] | undefined = res.headers['set-cookie'];
        const aspSessionIdCookie = cookies?.find((cookie) => cookie.trim().startsWith('ASP.NET_SessionId='));
        const aspSessionId = aspSessionIdCookie?.split(';')[0].split('=')[1];

        if (aspSessionId) {
          this.aspSessionId = aspSessionId;
        }

        return res;
      },
      (error) => {
        throw error;
      },
    );
  }
}
