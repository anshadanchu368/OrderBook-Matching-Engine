export function errorHandler(error, request, response, next) {
  console.error(error);

  response.status(400).json({
    success: false,
    error: error.message ?? "Something went wrong",
  });
}