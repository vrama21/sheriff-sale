import { parseStatusHistory } from './parseStatusHistory';
import { readFixture } from '../__fixtures__/stubClientAdapter';

describe('parseStatusHistory', () => {
  it('reads every history row of the status table, without the header row', () => {
    expect(parseStatusHistory(readFixture('listingDetailsPassaic.html'))).toEqual([
      { status: 'Scheduled', date: '9/19/2023' },
      { status: 'Adjourned - Defendant', date: '10/17/2023' },
      { status: 'Bankruptcy', date: '12/12/2023' },
      { status: 'Purchased - 3rd Party', date: '8/5/2025' },
      { status: 'Rescheduled', date: '10/20/2026' },
    ]);
  });

  it('parses minified rows the same as rows with whitespace between cells', () => {
    const html =
      '<table class="table" id="longTable"><thead><tr><th>Status</th><th>Date</th><th id="collapse"></th></tr></thead>' +
      '<tr><td>Scheduled</td><td>9/19/2023</td></tr><tr><td>Adjourned - Defendant</td><td>10/17/2023</td></tr></table>';

    expect(parseStatusHistory(html)).toEqual([
      { status: 'Scheduled', date: '9/19/2023' },
      { status: 'Adjourned - Defendant', date: '10/17/2023' },
    ]);
  });

  it('finds the table by its Status / Date header when it has no id', () => {
    const html =
      '<table><tr><th>Sheriff #</th></tr><tr><td>F-1</td><td>x</td></tr></table>' +
      '<table><thead><tr><th>Status </th><th>Date  </th></tr></thead><tr><td>Scheduled</td><td>9/19/2023</td></tr></table>';

    expect(parseStatusHistory(html)).toEqual([{ status: 'Scheduled', date: '9/19/2023' }]);
  });

  it('returns no history for a status table without rows', () => {
    const html = '<table id="longTable"><thead><tr><th>Status</th><th>Date</th></tr></thead></table>';

    expect(parseStatusHistory(html)).toEqual([]);
  });

  it('throws when the page has no status table', () => {
    expect(() => parseStatusHistory(readFixture('home.html'))).toThrow('Status history layout not recognised');
  });
});
