import { axiosInstance } from "@halo-dev/api-client";
import { FootprintApi } from "./footprint-api";

const footprintApiClient = {
  footprint: new FootprintApi(axiosInstance),
};

export { footprintApiClient }; 