import swaggerJsdoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Platypus API',
      version: '1.0.0',
      description: 'API documentation for Platypus',
    },
    servers: [
      {
        url: 'http://localhost:3000/',
        description: 'Development server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./src/controller/*.ts', './src/route/*.ts'],
};

const openapiSpecification = swaggerJsdoc(options);

export default openapiSpecification;