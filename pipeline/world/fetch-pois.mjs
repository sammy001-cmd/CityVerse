import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename =
  fileURLToPath(import.meta.url);

const __dirname =
  path.dirname(__filename);

const ROOT =
  path.resolve(__dirname, '../..');

const OUTPUT =
  path.join(
    ROOT,
    'apps/client/public/data/poi-source.json'
  );

const CENTER = {
  lat: 7.3962,
  lon: 3.8968
};

const CITY_RADIUS =
  Number(
    process.env.CITY_RADIUS ??
    15000
  );

const SERVERS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter'
];

const GROUPS = [
  {
    name: 'health',
    selectors: [
      'nwr["name"]["amenity"~"^(hospital|clinic|doctors|dentist|pharmacy)$"]',
      'nwr["name"]["healthcare"]'
    ]
  },

  {
    name: 'retail',
    selectors: [
      'nwr["name"]["shop"~"^(mall|department_store|supermarket|convenience)$"]',
      'nwr["name"]["amenity"="marketplace"]'
    ]
  },

  {
    name: 'hospitality',
    selectors: [
      'nwr["name"]["tourism"~"^(hotel|guest_house|hostel|motel)$"]'
    ]
  },

  {
    name: 'food-finance-fuel',
    selectors: [
      'nwr["name"]["amenity"~"^(restaurant|fast_food|cafe|bank|atm|fuel)$"]'
    ]
  },

  {
    name: 'education-emergency',
    selectors: [
      'nwr["name"]["amenity"~"^(school|university|college|police|fire_station)$"]'
    ]
  },

  {
    name: 'leisure-landmarks',
    selectors: [
      'nwr["name"]["leisure"~"^(park|garden|stadium|sports_centre)$"]',
      'nwr["name"]["tourism"~"^(attraction|museum)$"]',
      'nwr["name"]["historic"]'
    ]
  },

  {
    name: 'transport-government',
    selectors: [
      'nwr["name"]["amenity"~"^(bus_station|townhall|courthouse|place_of_worship)$"]',
      'nwr["name"]["public_transport"]',
      'nwr["name"]["railway"="station"]',
      'nwr["name"]["office"="government"]'
    ]
  }
];


const sleep =
  (ms) =>
    new Promise(
      (resolve) =>
        setTimeout(resolve, ms)
    );


function makeQuery(
  selectors
) {
  const body =
    selectors
      .map(
        (selector) =>
          `${selector}(around:${CITY_RADIUS},${CENTER.lat},${CENTER.lon});`
      )
      .join('\n');

  return `
[out:json][timeout:120];
(
${body}
);
out center tags;
`;
}


async function execute(
  server,
  query
) {
  const response =
    await fetch(
      server,
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/x-www-form-urlencoded;charset=UTF-8',

          Accept:
            'application/json',

          'User-Agent':
            'CityVerse/0.1 (+https://github.com/sammy001-cmd/CityVerse)'
        },

        body:
          'data=' +
          encodeURIComponent(query)
      }
    );

  if (!response.ok) {
    const error =
      new Error(
        `HTTP ${response.status}`
      );

    error.status =
      response.status;

    error.retryAfter =
      Number(
        response.headers.get(
          'retry-after'
        )
      );

    throw error;
  }

  return response.json();
}


const merged =
  new Map();


for (
  const group
  of GROUPS
) {
  console.log('');
  console.log(
    `Fetching POI group: ${group.name}`
  );

  const query =
    makeQuery(
      group.selectors
    );

  let success =
    false;

  let lastError =
    null;


  for (
    const server
    of SERVERS
  ) {
    for (
      let attempt = 1;
      attempt <= 2;
      attempt++
    ) {
      try {
        console.log(
          `  ${server} (attempt ${attempt})`
        );

        const result =
          await execute(
            server,
            query
          );

        const elements =
          result.elements ??
          [];

        console.log(
          `  received ${elements.length}`
        );


        for (
          const element
          of elements
        ) {
          const key =
            `${element.type}:${element.id}`;

          merged.set(
            key,
            element
          );
        }


        success =
          true;

        break;

      } catch (error) {
        lastError =
          error;

        console.warn(
          `  failed: ${error.message}`
        );


        const rateLimited =
          error.status === 429 ||
          error.status === 406;


        const waitMs =
          error.retryAfter > 0
            ? error.retryAfter * 1000
            : rateLimited
              ? 30000
              : 5000;


        console.log(
          `  waiting ${Math.round(waitMs / 1000)}s...`
        );


        await sleep(
          waitMs
        );
      }
    }


    if (success) {
      break;
    }
  }


  if (!success) {
    throw new Error(
      `Unable to fetch POI group "${group.name}": ` +
      `${lastError?.message ?? 'unknown error'}`
    );
  }


  // Deliberately serial.
  await sleep(
    2000
  );
}


const payload = {
  version: 1,

  generatedAt:
    new Date()
      .toISOString(),

  center:
    CENTER,

  radius:
    CITY_RADIUS,

  source:
    'OpenStreetMap',

  elements:
    [...merged.values()]
};


await fs.mkdir(
  path.dirname(OUTPUT),
  {
    recursive: true
  }
);


await fs.writeFile(
  OUTPUT,

  JSON.stringify(
    payload,
    null,
    2
  )
);


console.log('');
console.log(
  'CITYVERSE POI FETCH COMPLETE'
);
console.log(
  '----------------------------'
);
console.log(
  'Unique POIs:',
  payload.elements.length
);
console.log(
  'Output:',
  OUTPUT
);
console.log('');