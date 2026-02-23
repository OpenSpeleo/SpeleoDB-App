const AUTH_ENDPOINT = '**/api/v1/user/auth-token/**';
const PROJECTS_ENDPOINT = '**/api/v1/projects/geojson/**';
const GEOJSON_URL = 'https://example.com/p1.geojson';

function singleProjectResponseBody() {
  return {
    data: [
      {
        id: 'p1',
        name: 'Project One',
        description: '',
        country: 'FR',
        type: 'survey',
        visibility: 'public',
        is_active: true,
        created_by: 'user',
        creation_date: '2025-01-01',
        modified_date: '2025-01-01',
        commit_count: 1,
        active_mutex: null,
        fork_from: null,
        exclude_geojson: false,
        geojson_file: GEOJSON_URL,
        latest_commit: {
          id: 'c1',
          message: 'init',
          author_email: 'user@example.com',
          author_name: 'User',
          authored_date: '2025-01-01',
          dt_since: '1 day ago',
          parent_ids: [],
          url: '',
          formats: [],
          tree: [],
        },
      },
    ],
  };
}

function stubAuthSuccess(): void {
  cy.intercept('POST', AUTH_ENDPOINT, {
    statusCode: 200,
    body: {
      token: 'test-token',
      user: 'user@example.com',
    },
  });

  cy.intercept('GET', AUTH_ENDPOINT, {
    statusCode: 200,
    body: {
      detail: 'ok',
    },
  });
}

function stubProjectsWithOneProject(): void {
  cy.intercept('GET', PROJECTS_ENDPOINT, {
    statusCode: 200,
    body: singleProjectResponseBody(),
  });

  cy.intercept('GET', GEOJSON_URL, {
    statusCode: 200,
    body: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Point',
            coordinates: [2.3, 46.6],
          },
        },
      ],
    },
  });
}

function stubProjectsWithOneProjectDelayed(delayMs = 2500): void {
  cy.intercept('GET', PROJECTS_ENDPOINT, {
    statusCode: 200,
    delay: delayMs,
    body: singleProjectResponseBody(),
  });

  cy.intercept('GET', GEOJSON_URL, {
    statusCode: 200,
    body: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Point',
            coordinates: [2.3, 46.6],
          },
        },
      ],
    },
  });
}

function stubProjectsWithOneProjectWithDepth(): void {
  cy.intercept('GET', PROJECTS_ENDPOINT, {
    statusCode: 200,
    body: singleProjectResponseBody(),
  });

  cy.intercept('GET', GEOJSON_URL, {
    statusCode: 200,
    body: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [
              [2.3, 46.6, -10],
              [2.31, 46.61, -25],
            ],
          },
        },
      ],
    },
  });
}

function stubProjectsEmpty(): void {
  cy.intercept('GET', PROJECTS_ENDPOINT, {
    statusCode: 200,
    body: {
      data: [],
    },
  });
}

function loginToDashboard(): void {
  cy.visit('/login');
  cy.get('input#email').type('user@example.com');
  cy.get('input#password').type('password123');
  cy.get('button[type="submit"]').click();
  cy.contains('Start exploring', { timeout: 15000 }).should('be.visible');
}

function dismissOnboarding(): void {
  cy.contains('button', 'Start exploring').filter(':visible').first().click();
}

function startPullToRefreshStep(): void {
  cy.get('ion-refresher.dashboard-refresher').then(($refresher) => {
    const event = new Event('ionRefresh', { bubbles: true });
    $refresher[0].dispatchEvent(event);
  });
}

function completePullToRefreshStep(): void {
  cy.document().then((doc) => {
    doc.dispatchEvent(new CustomEvent('speleo:refresh-complete'));
  });
}

describe('Guided Tour', () => {
  it('runs full guided tour with project steps and persists completion', () => {
    stubAuthSuccess();
    stubProjectsWithOneProject();
    loginToDashboard();

    dismissOnboarding();

    cy.contains('.driver-popover-title', 'Status bar');
    cy.contains('button', 'Next').click();

    cy.contains('.driver-popover-title', 'Pull down and refresh');
    startPullToRefreshStep();
    cy.contains('.driver-popover-title', 'Pull down and refresh').should('be.visible');
    completePullToRefreshStep();

    cy.contains('.driver-popover-title', 'Open the project panel', { timeout: 5000 });
    cy.get('[data-tour="menu-toggle"]').click();

    cy.contains('.driver-popover-title', 'Hide all projects', { timeout: 5000 });
    cy.get('[data-tour-action="hide-all"]').click();
    cy.contains('.driver-popover-title', 'Show all projects', { timeout: 5000 });
    cy.get('[data-tour-action="show-all"]').click();

    cy.contains('.driver-popover-title', 'Toggle one project', { timeout: 5000 });
    cy.get('[data-tour="project-name"]').click({ force: true });
    cy.contains('.driver-popover-title', 'Toggle one project', { timeout: 5000 }).should('be.visible');
    cy.get('[data-tour="project-panel"][data-tour-open="true"]').should('exist');
    cy.get('[data-tour="project-toggle"]').click();

    cy.contains('.driver-popover-title', 'Center on a project', { timeout: 5000 });
    cy.get('[data-tour="project-name"]').click();
    cy.get('[data-tour="project-panel"][data-tour-open="false"]', { timeout: 5000 }).should('exist');

    cy.contains('.driver-popover-title', 'Tour complete', { timeout: 5000 });
    cy.contains('button', 'Finish').click();
    cy.get('.driver-popover').should('not.exist');

    cy.window().then((win) => {
      const raw = win.localStorage.getItem('speleo_user_preferences');
      expect(raw).to.not.be.null;
      const prefs = JSON.parse(raw!);
      expect(prefs.hasCompletedGuidedTour).to.equal(true);
    });
  });

  it('restarts from help button even when already completed', () => {
    stubAuthSuccess();
    stubProjectsWithOneProject();

    cy.visit('/dashboard', {
      onBeforeLoad(win) {
        win.localStorage.setItem(
          'speleo_user_preferences',
          JSON.stringify({
            email: 'user@example.com',
            token: 'test-token',
            instance: 'https://www.speleodb.org',
            hasCompletedGuidedTour: true,
          }),
        );
      },
    });

    cy.get('.driver-popover').should('not.exist');
    cy.get('button[aria-label="Start guided tour"]').click();
    cy.contains('.driver-popover-title', 'Status bar', { timeout: 5000 }).should('be.visible');
  });

  it('persists completion when closed early and does not auto-start again', () => {
    stubAuthSuccess();
    stubProjectsWithOneProject();
    loginToDashboard();

    dismissOnboarding();
    cy.contains('.driver-popover-title', 'Status bar', { timeout: 5000 }).should('be.visible');

    cy.contains('.driver-popover button', 'Close').click();
    cy.get('.driver-popover').should('not.exist');

    cy.window().then((win) => {
      const raw = win.localStorage.getItem('speleo_user_preferences');
      expect(raw).to.not.be.null;
      const prefs = JSON.parse(raw!);
      expect(prefs.hasCompletedGuidedTour).to.equal(true);
    });

    cy.reload();
    cy.wait(1200);
    cy.get('.driver-popover').should('not.exist');
  });

  it('proceeds to project steps when project targets appear after show-all', () => {
    stubAuthSuccess();
    stubProjectsWithOneProjectDelayed(3500);
    loginToDashboard();

    dismissOnboarding();
    cy.contains('button', 'Next').click();
    startPullToRefreshStep();
    completePullToRefreshStep();

    cy.contains('.driver-popover-title', 'Open the project panel', { timeout: 5000 });
    cy.get('[data-tour="menu-toggle"]').click();
    cy.contains('.driver-popover-title', 'Hide all projects', { timeout: 5000 });
    cy.get('[data-tour-action="hide-all"]').click();
    cy.contains('.driver-popover-title', 'Show all projects', { timeout: 5000 });
    cy.get('[data-tour-action="show-all"]').click();

    cy.contains('.driver-popover-title', 'Toggle one project', { timeout: 12000 }).should('be.visible');
  });

  it('skips project-specific steps when no projects are available', () => {
    stubAuthSuccess();
    stubProjectsEmpty();
    loginToDashboard();

    dismissOnboarding();
    cy.contains('button', 'Next').click();
    startPullToRefreshStep();
    completePullToRefreshStep();

    cy.contains('.driver-popover-title', 'Open the project panel', { timeout: 5000 });
    cy.get('[data-tour="menu-toggle"]').click();
    cy.contains('.driver-popover-title', 'Hide all projects', { timeout: 5000 });
    cy.get('[data-tour-action="hide-all"]').click();
    cy.contains('.driver-popover-title', 'Show all projects', { timeout: 5000 });
    cy.get('[data-tour-action="show-all"]').click();

    cy.contains('.driver-popover-title', 'Tour complete', { timeout: 5000 }).should('be.visible');
  });

  it('updates color mode from settings and persists depth mode on reload', () => {
    stubAuthSuccess();
    stubProjectsWithOneProjectWithDepth();

    cy.visit('/login', {
      onBeforeLoad(win) {
        win.localStorage.setItem(
          'speleo_user_preferences',
          JSON.stringify({
            hasCompletedGuidedTour: true,
            instance: 'https://www.speleodb.org',
          }),
        );
      },
    });

    cy.get('input#email').type('user@example.com');
    cy.get('input#password').type('password123');
    cy.get('button[type="submit"]').click();
    cy.contains('Start exploring', { timeout: 15000 }).should('be.visible');
    cy.contains('button', 'Start exploring').filter(':visible').first().click();

    cy.contains('button', 'Settings').click();
    cy.get('[data-testid="color-mode-selector"]').select('depth', { force: true });
    cy.get('[data-testid="measurement-unit-selector"]').select('feet', { force: true });

    cy.window().then((win) => {
      const raw = win.localStorage.getItem('speleo_user_preferences');
      expect(raw).to.not.be.null;
      const prefs = JSON.parse(raw!);
      expect(prefs.colorMode).to.equal('depth');
      expect(prefs.measurementUnit).to.equal('feet');
    });

    cy.contains('button', 'Map').click();
    cy.get('[data-testid="depth-gauge"]', { timeout: 10000 }).should('be.visible');
    cy.get('[data-testid="distance-scale"]').should('be.visible');

    cy.reload();
    cy.get('body').then(($body) => {
      if ($body.text().includes('Start exploring')) {
        cy.contains('button', 'Start exploring').filter(':visible').first().click();
      }
    });
    cy.get('[data-testid="depth-gauge"]', { timeout: 10000 }).should('be.visible');
  });
});
